import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  ApiError, forgetSignup, signupAvailability, signupCode, signupEmailCode, signupEmailResume, signupEmailStatus, signupEnterTelegram,
  signupRegister, signupTelegram, signupTelegramStatus, type SignupCodeSent, type SignupEmailSent, type SignupEmailWaiting, type SignupForm,
} from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { Loading, Spinner } from '../layout/Loading'
import { LoginQr } from '../layout/LoginQr'
import { NewPasswordFields } from '../layout/PasswordFields'
import { Select } from '../layout/Select'
import { CITIES } from '../lib/clinicSearch'
import { inAppBrowser } from '../lib/inAppBrowser'
import { useQrScreen } from '../lib/qrScreen'
import { useCountdown } from '../lib/otp'
import { passwordProblem } from '../lib/password'
import { clearCodeSent, markCodeSent, recentCodeSent } from './codeMark'
import { NextSteps } from './NextSteps'

/** Как часто спрашиваем сервер, пока ждём «✅ Да, это я» в боте. */
export const POLL_MS = 2000

/** Письмо в «Спаме»: Gmail выключает там ссылки — «Не спам» или код. То же — первой строкой в самом письме. */
export const SPAM_HINT = 'Письмо в «Спаме»? Нажмите «Не спам» — тогда кнопка заработает. Или просто введите код.'

/** 409 сервера: номер уже у сотрудника клиники или с него уже зарегистрирована клиника — тогда «Войти». */
const PHONE_TAKEN = 'phone-in-clinic'

type Step =
  | { kind: 'form' }
  | { kind: 'code'; sent: SignupCodeSent }
  | { kind: 'email'; sent: SignupEmailSent }
  /** страницу перезагрузили, cookie шага жива — снова «Код из письма» (формы в памяти уже нет) */
  | { kind: 'emailAgain'; waiting: SignupEmailWaiting }
  /** «Уже есть код из письма?» — почта и код без cookie шага */
  | { kind: 'resume' }
  /** код подошёл — «Придумайте пароль» */
  | { kind: 'resumed'; waiting: SignupEmailWaiting; code: string }
  | { kind: 'telegram'; link: string }
  | { kind: 'creating'; text: string }
  | { kind: 'next'; clinicName: string }

/**
 * «Попробовать бесплатно» — клиника регистрируется сама (/start), без заявки и звонка. Один экран формы:
 * название клиники (или своё имя, если работаете один), город, имя, телефон, согласие. Выбора «частный врач /
 * клиника» нет: и там, и там регистрируется один человек и добавляет коллег сам. Подтвердить, что
 * это вы, — кодом из SMS на этот номер (и придумать пароль) или кнопкой «✅ Да, это я» в боте Telegram (что
 * включено на сервере — GET /web/signup). Сервер сразу заводит клинику и даёт сессию: человек в CRM руководителем
 * и врачом (так видно всё приложение), дальше тур и «Что настроить». Не принимает пациентов — потом сам ставит себе
 * в «Персонале» роль «Руководитель».
 * <p>
 * Поля формы — без React-состояния, значения читаются при отправке (как на /join: во встроенном браузере
 * Instagram на Android клавиатура закрывалась от перерисовок). Номер, имя, код и пароль — только в памяти
 * страницы и в теле запросов: не в localStorage и не в адресе.
 * <p>
 * Через Telegram регистрация завершается в боте: по «✅ Да, это я» сервер сразу создаёт клинику, бот присылает
 * «Открыть день» — врачам из Instagram возвращаться во встроенный браузер не нужно. Вернулся (или перезагрузил
 * страницу) — сервер по HttpOnly-cookie говорит «готово», и страница входит без формы.
 *
 * <p>
 * Во встроенном браузере Instagram (и Facebook, TikTok, Threads — lib/inAppBrowser) Telegram — главный путь с подсказкой
 * «Tish останется у вас в Telegram», остальное — мелкой ссылкой: вход, сохранённый во встроенном браузере, пропадёт,
 * как только человек закроет приложение. «Или подтвердить по почте» (почта настроена на сервере) — письмо со ссылкой
 * «Подтвердить и открыть Tish»: её открывают из почты уже в настоящем браузере (/start/confirm, ConfirmPage), а код из
 * того же письма можно ввести и здесь. SMS — только если включены для регистрации (SIGNUP_SMS_ENABLED на сервере).
 * После регистрации по SMS или почте — экран «Что дальше» (NextSteps): как входить потом и «Подключить Telegram».
 * <p>
 * Шаг кода из письма держит HttpOnly-cookie: перезагрузили страницу — сервер говорит, что форма ждёт, и страница снова
 * на шаге кода (спрашиваем, только если с этого устройства недавно отправляли код — метка codeMark, без ПДн). Встроенный
 * браузер Instagram, закрывшись, теряет и cookie: тогда под формой «Уже есть код из письма?» — почта и код → пароль
 * (сервер находит регистрацию по почте и коду и ставит cookie шага заново), а над формой — подсказка, если код недавно
 * отправляли.
 *
 * @param onDone куда после регистрации (по умолчанию — в CRM; тест подставляет свою)
 * @param userAgent только тесты: подставить userAgent встроенного браузера
 */
export function SignupPage({ onDone = () => window.location.assign('/'), userAgent }: { onDone?: () => void; userAgent?: string }) {
  const inApp = inAppBrowser(userAgent)
  const client = useQueryClient()
  const ways = useQuery({ queryKey: ['signup-ways'], queryFn: signupAvailability, retry: false, staleTime: Infinity })
  const [phone, setPhone] = useState('')
  const [form, setForm] = useState<SignupForm | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [smsDown, setSmsDown] = useState(false)
  const [emailMode, setEmailMode] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const qr = useQrScreen()
  const [qrBusy, setQrBusy] = useState(false)
  /** С этого устройства недавно отправляли код на почту, а шаг не восстановился — подсказка над формой. */
  const [codeHint, setCodeHint] = useState(false)

  useEffect(() => { document.title = 'Попробовать Tish бесплатно' }, [])

  const finish = useCallback(async (f: SignupForm, confirm: Parameters<typeof signupRegister>[1]) => {
    setError(null)
    setBusy(true)
    try {
      const done = await signupRegister(f, confirm)
      clearCodeSent()
      // Сессия уже в cookie — «кто я» спросим заново в CRM; сначала — «Что дальше»: как не потерять Tish
      void client.invalidateQueries({ queryKey: ['me'] })
      setStep({ kind: 'next', clinicName: done.clinicName })
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
    } finally {
      setBusy(false)
    }
  }, [client])

  /** Клиника уже создана в боте — войти в неё (форма не нужна). */
  const enter = useCallback(async () => {
    setError(null)
    setStep({ kind: 'creating', text: 'Готово — клиника создана. Входим…' })
    try {
      await signupEnterTelegram()
      void client.invalidateQueries({ queryKey: ['me'] })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
      setStep({ kind: 'form' })
    }
  }, [client, onDone])

  // При открытии: может, клиника уже создана в боте (страницу перезагрузили или вернулись из Telegram)
  useEffect(() => {
    let alive = true
    signupTelegramStatus().then((s) => { if (alive && s.state === 'confirmed') void enter() }).catch(() => undefined)
    return () => { alive = false }
  }, [enter])

  // Недавно отправляли код на почту: может, шаг кода ещё жив (cookie) — тогда снова он, иначе подсказка над формой
  useEffect(() => {
    if (!recentCodeSent()) return
    let alive = true
    signupEmailStatus()
      .then((s) => {
        if (!alive) return
        if (s.state === 'waiting') setStep((prev) => prev.kind === 'form' ? { kind: 'emailAgain', waiting: s } : prev)
        else setCodeHint(true)
      })
      .catch(() => { if (alive) setCodeHint(true) })
    return () => { alive = false }
  }, [])

  // Ждём кнопку в боте — опрос раз в 2 секунды и сразу, когда вернулись во вкладку
  const waiting = step.kind === 'telegram'
  useEffect(() => {
    if (!waiting) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      clearTimeout(timer)
      try {
        const s = await signupTelegramStatus()
        if (!alive) return
        if (s.state === 'confirmed') {
          void enter()
          return
        }
        if (s.state !== 'waiting') {
          setStep({ kind: 'form' })
          setError(new ApiError(0, s.state === 'failed' && s.error ? s.error
            : s.state === 'cancelled' ? 'Регистрация отменена в Telegram.' : 'Время на подтверждение вышло — нажмите «Подтвердить через Telegram» ещё раз.'))
          return
        }
      } catch {
        // Нет связи на секунду — спросим снова
      }
      if (alive) timer = setTimeout(() => void poll(), POLL_MS)
    }
    timer = setTimeout(() => void poll(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [waiting, enter])

  /** Значения формы при отправке. */
  const read = (): SignupForm => {
    const data = new FormData(formRef.current!)
    const field = (k: string) => String(data.get(k) ?? '').trim()
    return {
      clinicName: field('clinicName'), city: field('city'),
      fullName: field('fullName'), phone: phoneFromInput(phone), consent: data.get('consent') === 'on',
    }
  }

  const start = async (how: 'SMS' | 'TELEGRAM' | 'EMAIL') => {
    const f = read()
    setForm(f)
    setError(null)
    setBusy(true)
    try {
      if (how === 'SMS') {
        setStep({ kind: 'code', sent: await signupCode(f) })
      } else if (how === 'EMAIL') {
        const email = String(new FormData(formRef.current!).get('email') ?? '').trim()
        setStep({ kind: 'email', sent: await signupEmailCode(f, email) })
        markCodeSent()
      } else {
        const started = await signupTelegram(f)
        setStep({ kind: 'telegram', link: started.link })
        try {
          window.open(started.link, '_blank', 'noopener')
        } catch {
          // окно не дали открыть — под текстом остаётся кнопка «Открыть Telegram»
        }
      }
    } catch (e) {
      // SMS не ушла (503 — шлюз не отправил): кнопку SMS прячем, остаётся Telegram — второй раз не мучить
      if (how === 'SMS' && e instanceof ApiError && e.status === 503 && ways.data?.telegram) {
        setSmsDown(true)
        setError(new ApiError(503, 'SMS сейчас не отправляются — подтвердите номер через Telegram: кнопка ниже'))
      } else {
        setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
      }
    } finally {
      setBusy(false)
    }
  }

  /** «Обновить код»: новая ссылка в бота с той же формой — для QR-кода, без нового окна Telegram. */
  const refreshQr = async () => {
    if (!form) return
    setQrBusy(true)
    try {
      setStep({ kind: 'telegram', link: (await signupTelegram(form)).link })
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
      setStep({ kind: 'form' })
    } finally {
      setQrBusy(false)
    }
  }

  const back = () => {
    void forgetSignup().catch(() => undefined)
    setError(null)
    setStep({ kind: 'form' })
  }

  /** «Уже есть код из письма?» и назад к форме — без запроса: шаг на сервере не трогаем. */
  const openResume = () => {
    setError(null)
    setStep({ kind: 'resume' })
  }
  const toForm = () => {
    setError(null)
    setStep({ kind: 'form' })
  }
  const emailIntro = (masked?: string) => (
    <>Письмо отправлено на <b>{masked}</b>. Откройте почту и нажмите «Подтвердить» — Tish откроется в браузере. Или введите код
      из письма:</>
  )
  const noForm: SignupForm = {}

  // Форма остаётся в разметке (скрыта) на шагах кода и Telegram: «Изменить данные» — вписанное на месте
  let body: React.ReactNode = null
  if (ways.isPending) body = <Loading text="Открываем…" />
  else if (step.kind === 'creating') body = <Loading text={step.text} />
  else if (step.kind === 'next') body = <NextSteps clinicName={step.clinicName} onDone={onDone} userAgent={userAgent} />
  else if (step.kind === 'email' && form) {
    body = <CodeStepForm form={form} sent={step.sent} busy={busy} error={error} onBack={back} title="Код из письма"
      intro={emailIntro(step.sent.emailMasked)} note={SPAM_HINT}
      onResend={async () => {
        const email = String(new FormData(formRef.current!).get('email') ?? '').trim()
        setStep({ kind: 'email', sent: await signupEmailCode(form, email) })
      }}
      onSubmit={(code, password) => void finish(form, { method: 'EMAIL', code, password })} />
  }
  else if (step.kind === 'emailAgain') {
    body = <CodeStepForm form={noForm} sent={{ secondsLeft: step.waiting.secondsLeft, resendSeconds: 0 }} busy={busy} error={error}
      onBack={back} title="Код из письма" intro={emailIntro(step.waiting.emailMasked)} note={SPAM_HINT}
      onSubmit={(code, password) => void finish(noForm, { method: 'EMAIL', code, password })} />
  }
  else if (step.kind === 'resume') {
    body = <ResumeStep onBack={toForm} onResumed={(waiting, code) => { setError(null); setStep({ kind: 'resumed', waiting, code }) }} />
  }
  else if (step.kind === 'resumed') {
    const resumed = step
    body = <ResumedPassword waiting={resumed.waiting} busy={busy} error={error} onBack={toForm}
      onSubmit={(password) => void finish(noForm, { method: 'EMAIL', code: resumed.code, password })} />
  }
  else if (step.kind === 'code' && form) {
    body = <CodeStepForm form={form} sent={step.sent} busy={busy} error={error} onBack={back}
      onResend={async () => { setStep({ kind: 'code', sent: await signupCode(form) }) }}
      onSubmit={(code, password) => void finish(form, { method: 'SMS', code, password })} />
  } else if (step.kind === 'telegram') {
    body = (
      <div className="telegram-login waiting" role="status" aria-label="Ждём подтверждения в Telegram">
        <h1>Подтвердите в Telegram</h1>
        <p><Spinner />Откройте бота Tish и нажмите «✅ Да, это я».</p>
        <a className="btn tg-login" href={step.link} target="_blank" rel="noopener noreferrer">Открыть Telegram</a>
        <p className="hint">После «Да» клиника создастся сразу. Можно не возвращаться: всё откроется прямо в Telegram — кнопка «Открыть день». Вернётесь сюда — войдёте сами.</p>
        {qr && <LoginQr link={step.link} busy={qrBusy} onRefresh={() => void refreshQr()}
          caption="Нет Telegram на компьютере? Наведите камеру телефона на код → «✅ Да, это я» в боте — компьютер войдёт сам" />}
        <button type="button" className="link" onClick={back}>Изменить данные</button>
      </div>
    )
  }
  let formBody: React.ReactNode = null
  if (!ways.isPending) {
    const w = ways.data ?? { sms: false, telegram: false, email: false }
    const e = error
    const err = (k: string) => e?.fieldErrors[k] && <p className="error">{e.fieldErrors[k]}</p>
    const taken = e?.status === 409 && e.code === PHONE_TAKEN
    const other = e && !Object.keys(e.fieldErrors).length ? e.message : ''
    formBody = (
      <div className="signup-step" hidden={step.kind !== 'form'}>
        <h1>Попробовать Tish бесплатно</h1>
        {w.email && codeHint && (
          <p className="hint signup-resume-hint" role="note">Отправляли код на почту? — <button type="button" className="link"
            onClick={openResume}>«Уже есть код из письма»</button></p>
        )}
        <p className="hint">Создайте клинику за пару минут — без заявки и звонка. Всё приложение, без ограничений.</p>
        <form ref={formRef} className="form narrow invite-form signup-form" aria-label="Регистрация клиники"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault()
            void start(emailMode ? 'EMAIL' : w.telegram ? 'TELEGRAM' : w.sms && !smsDown ? 'SMS' : 'EMAIL')
          }}>
          <label className="field"><span>Название клиники</span>
            <input name="clinicName" maxLength={100} autoComplete="off" placeholder="Стоматология «Улыбка»" aria-describedby="signup-clinic-hint" /></label>
          <p id="signup-clinic-hint" className="hint small field-note">или ваше имя, если работаете один</p>
          {err('clinicName')}
          <label className="field"><span>Город</span>
            <Select name="city" defaultValue="">
              <option value="">Выберите город</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="Другой">Другой город</option>
            </Select></label>
          {err('city')}
          <label className="field"><span>Ваше имя</span>
            <input name="fullName" maxLength={100} autoComplete="off" placeholder="Айгерим Садыкова" /></label>
          {err('fullName')}
          <label className="field"><span>Ваш телефон</span><PhoneInput label="Ваш телефон" value={phone} onChange={setPhone} /></label>
          {err('phone')}
          <label className="check"><input type="checkbox" name="consent" /> Согласен(на) с условиями Tish и с тем, что мои имя и телефон
            используются для работы аккаунта клиники</label>
          {err('consent')}
          {taken && <p className="error" role="alert">{e.message}. <a href="/login">Войти в Tish</a></p>}
          {!taken && other && <p className="error" role="alert">{other}</p>}
          {!w.sms && !w.telegram && !w.email && <p className="error" role="alert">Регистрация сейчас недоступна — напишите нам, подключим вручную.</p>}
          {w.telegram && (
            <button type={emailMode ? 'button' : 'submit'} className="btn tg-login" disabled={busy}
              onClick={emailMode ? () => void start('TELEGRAM') : undefined}>
              {busy && !emailMode ? <><Spinner />Проверяем…</> : 'Подтвердить через Telegram'}</button>
          )}
          {w.telegram && inApp && (
            <p className="hint small signup-tg-hint">Через Telegram удобнее: Tish останется у вас в Telegram — кнопка «Открыть день»</p>
          )}
          {w.email && emailMode && (
            <>
              <label className="field"><span>Почта</span>
                <input name="email" type="email" inputMode="email" maxLength={254} autoComplete="email" placeholder="name@gmail.com" /></label>
              {err('email')}
              <button type={w.telegram ? 'button' : 'submit'} className={w.telegram ? 'btn' : 'btn primary'} disabled={busy}
                onClick={w.telegram ? () => void start('EMAIL') : undefined}>
                {busy ? <><Spinner />Отправляем…</> : 'Получить письмо'}</button>
            </>
          )}
          {w.email && !emailMode && (
            <button type="button" className="link signup-alt" onClick={() => setEmailMode(true)}>или подтвердить по почте</button>
          )}
          {w.sms && !smsDown && (w.telegram && inApp ? (
            <button type="button" className="link signup-alt" disabled={busy} onClick={() => void start('SMS')}>или по SMS</button>
          ) : (
            <button type={w.telegram || emailMode ? 'button' : 'submit'} className={w.telegram || emailMode ? 'btn' : 'btn primary'} disabled={busy}
              onClick={w.telegram || emailMode ? () => void start('SMS') : undefined}>
              {busy && !w.telegram && !emailMode ? <><Spinner />Проверяем…</> : 'Получить код по SMS'}</button>
          ))}
        </form>
        {w.email && <button type="button" className="link signup-alt" onClick={openResume}>Уже есть код из письма?</button>}
        <p className="hint small">Уже в Tish? <a href="/login">Войти</a> · Нужна помощь с подключением? <a href="/join#form">Оставьте заявку</a></p>
      </div>
    )
  }
  return (
    <div className="center login invite-page signup-page">
      <div className="login-card">
        <a href="/about" aria-label="О Tish"><img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={96} height={92} /></a>
        {body}
        {formBody}
      </div>
    </div>
  )
}

/** Шаг «Код из SMS»: код и «Придумайте пароль» (по номеру и паролю — вход потом) → «Создать клинику». */
function CodeStepForm({ form, sent, busy, error, onBack, onResend, onSubmit, title = 'Код из SMS', intro, note }: {
  form: SignupForm; sent: { secondsLeft: number; resendSeconds: number; phoneMasked?: string }; busy: boolean; error: ApiError | null
  onBack: () => void; onResend?: () => Promise<void>; onSubmit: (code: string, password: string) => void
  title?: string; intro?: React.ReactNode; note?: string
}) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [check, setCheck] = useState('')
  const [resendError, setResendError] = useState('')
  const [wait, restart] = useCountdown()
  useEffect(() => { restart(sent.resendSeconds) }, [sent]) // eslint-disable-line react-hooks/exhaustive-deps -- с каждой отправкой
  const codeError = error?.fieldErrors.code
  const passwordError = check || error?.fieldErrors.password
  const other = error && !codeError && !error.fieldErrors.password ? error.message : ''
  return (
    <>
      <h1>{title}</h1>
      <form className="form narrow invite-form" aria-label={title} onSubmit={(ev) => {
        ev.preventDefault()
        const problem = passwordProblem(password, repeat, form.phone ?? '')
        setCheck(problem)
        if (!problem) onSubmit(code, password)
      }}>
        <p className="hint" role="status">{intro ?? <>Отправили SMS с кодом на <b>{sent.phoneMasked}</b>.</>} Код действует {Math.max(1, Math.ceil(sent.secondsLeft / 60))} мин.</p>
        {note && <p className="hint small signup-spam-hint">{note}</p>}
        <CodeInput value={code} onChange={setCode} />
        {codeError && <p className="error">{codeError}</p>}
        <NewPasswordFields password={password} repeat={repeat} phone={form.phone ?? ''} label="Придумайте пароль для входа"
          onPassword={(v) => { setPassword(v); setCheck('') }} onRepeat={(v) => { setRepeat(v); setCheck('') }} />
        {passwordError && <p className="error">{passwordError}</p>}
        {other && <p className="error" role="alert">{other}</p>}
        <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>
          {busy ? <><Spinner />Создаём…</> : 'Создать клинику'}</button>
        {resendError && <p className="error" role="alert">{resendError}</p>}
        <div className="actions">
          {onResend && <ResendLink wait={wait} sms={false} busy={busy} onSms={() => undefined}
            onAgain={() => { setResendError(''); onResend().catch((e: unknown) => setResendError(e instanceof Error ? e.message : 'Нет связи с сервером')) }} />}
          <button type="button" className="link" onClick={onBack}>Изменить данные</button>
        </div>
      </form>
    </>
  )
}

/**
 * «Уже есть код из письма?»: почта и код → «Дальше». Сервер находит регистрацию по ним без cookie шага (её теряет
 * встроенный браузер Instagram). Неверный код и неизвестная почта — один ответ «Код не подошёл или устарел»; верный, но
 * истёкший — «Код устарел — заполните форму ещё раз»; по письму уже создали — «Войти». Почта — без React-состояния
 * (клавиатура во встроенном браузере), обе — только в теле запроса.
 */
function ResumeStep({ onBack, onResumed }: { onBack: () => void; onResumed: (waiting: SignupEmailWaiting, code: string) => void }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const submit = async () => {
    const email = String(new FormData(formRef.current!).get('email') ?? '').trim()
    setError(null)
    setBusy(true)
    try {
      onResumed(await signupEmailResume(email, code), code)
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
    } finally {
      setBusy(false)
    }
  }
  const gone = error?.status === 410
  const other = error && !gone && !Object.keys(error.fieldErrors).length ? error.message : ''
  return (
    <div className="signup-step">
      <h1>Код из письма</h1>
      <form ref={formRef} className="form narrow invite-form" aria-label="Уже есть код из письма"
        onSubmit={(ev) => { ev.preventDefault(); void submit() }}>
        <p className="hint">Окно закрылось, а код остался в почте? Впишите почту, на которую пришло письмо, и код из него.</p>
        <label className="field"><span>Почта</span>
          <input name="email" type="email" inputMode="email" maxLength={254} autoComplete="email" placeholder="name@gmail.com" /></label>
        {error?.fieldErrors.email && <p className="error">{error.fieldErrors.email}</p>}
        <CodeInput value={code} onChange={setCode} />
        {error?.fieldErrors.code && <p className="error" role="alert">{error.fieldErrors.code}</p>}
        {gone && (
          <p className="error" role="alert">{error.message}{' '}
            {error.code === 'already-registered' ? <a href="/login">Войти в Tish</a>
              : <button type="button" className="link" onClick={onBack}>Заполнить форму</button>}</p>
        )}
        {other && <p className="error" role="alert">{other}</p>}
        <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>
          {busy ? <><Spinner />Проверяем…</> : 'Дальше'}</button>
        <p className="hint small">{SPAM_HINT}</p>
        <button type="button" className="link" onClick={onBack}>Заполнить форму</button>
      </form>
    </div>
  )
}

/** Код подошёл: что создадим (название, номер маской) и «Придумайте пароль» → «Создать клинику». */
function ResumedPassword({ waiting, busy, error, onBack, onSubmit }: {
  waiting: SignupEmailWaiting; busy: boolean; error: ApiError | null; onBack: () => void; onSubmit: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [check, setCheck] = useState('')
  const passwordError = check || error?.fieldErrors.password
  const codeError = error?.fieldErrors.code
  const other = error && !codeError && !error.fieldErrors.password ? error.message : ''
  return (
    <div className="signup-step">
      <h1>Придумайте пароль</h1>
      <form className="form narrow invite-form" aria-label="Пароль для входа" onSubmit={(ev) => {
        ev.preventDefault()
        const problem = passwordProblem(password, repeat, '')
        setCheck(problem)
        if (!problem) onSubmit(password)
      }}>
        <p className="hint">Код подошёл. {waiting.clinicName}, телефон {waiting.phoneMasked}. С этим номером и паролем входите в Tish
          на любом устройстве.</p>
        <NewPasswordFields password={password} repeat={repeat} phone="" label="Придумайте пароль для входа"
          onPassword={(v) => { setPassword(v); setCheck('') }} onRepeat={(v) => { setRepeat(v); setCheck('') }} />
        {passwordError && <p className="error">{passwordError}</p>}
        {codeError && <p className="error" role="alert">{codeError}{' '}
          <button type="button" className="link" onClick={onBack}>Заполнить форму</button></p>}
        {other && <p className="error" role="alert">{other}</p>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner />Создаём…</> : 'Создать клинику'}</button>
      </form>
    </div>
  )
}
