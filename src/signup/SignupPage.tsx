import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  ApiError, forgetSignup, signupAvailability, signupCode, signupEmailCode, signupEnterTelegram, signupRegister, signupTelegram,
  signupTelegramStatus, type SignupCodeSent, type SignupEmailSent, type SignupForm,
} from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { Loading, Spinner } from '../layout/Loading'
import { NewPasswordFields } from '../layout/PasswordFields'
import { Select } from '../layout/Select'
import { CITIES } from '../lib/clinicSearch'
import { inAppBrowser } from '../lib/inAppBrowser'
import { useCountdown } from '../lib/otp'
import { passwordProblem } from '../lib/password'
import { NextSteps } from './NextSteps'

/** Как часто спрашиваем сервер, пока ждём «✅ Да, это я» в боте. */
export const POLL_MS = 2000

/** 409 сервера: номер уже у сотрудника клиники или с него уже зарегистрирована клиника — тогда «Войти». */
const PHONE_TAKEN = 'phone-in-clinic'

type Step =
  | { kind: 'form' }
  | { kind: 'code'; sent: SignupCodeSent }
  | { kind: 'email'; sent: SignupEmailSent }
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

  useEffect(() => { document.title = 'Попробовать Tish бесплатно' }, [])

  const finish = useCallback(async (f: SignupForm, confirm: Parameters<typeof signupRegister>[1]) => {
    setError(null)
    setBusy(true)
    try {
      const done = await signupRegister(f, confirm)
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

  const back = () => {
    void forgetSignup().catch(() => undefined)
    setError(null)
    setStep({ kind: 'form' })
  }

  // Форма остаётся в разметке (скрыта) на шагах кода и Telegram: «Изменить данные» — вписанное на месте
  let body: React.ReactNode = null
  if (ways.isPending) body = <Loading text="Открываем…" />
  else if (step.kind === 'creating') body = <Loading text={step.text} />
  else if (step.kind === 'next') body = <NextSteps clinicName={step.clinicName} onDone={onDone} userAgent={userAgent} />
  else if (step.kind === 'email' && form) {
    body = <CodeStepForm form={form} sent={step.sent} busy={busy} error={error} onBack={back} title="Код из письма"
      intro={<>Письмо отправлено на <b>{step.sent.emailMasked}</b>. Откройте почту и нажмите «Подтвердить» — Tish откроется в
        браузере. Или введите код из письма:</>}
      onResend={async () => {
        const email = String(new FormData(formRef.current!).get('email') ?? '').trim()
        setStep({ kind: 'email', sent: await signupEmailCode(form, email) })
      }}
      onSubmit={(code, password) => void finish(form, { method: 'EMAIL', code, password })} />
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
function CodeStepForm({ form, sent, busy, error, onBack, onResend, onSubmit, title = 'Код из SMS', intro }: {
  form: SignupForm; sent: { secondsLeft: number; resendSeconds: number; phoneMasked?: string }; busy: boolean; error: ApiError | null
  onBack: () => void; onResend: () => Promise<void>; onSubmit: (code: string, password: string) => void
  title?: string; intro?: React.ReactNode
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
          <ResendLink wait={wait} sms={false} busy={busy} onSms={() => undefined}
            onAgain={() => { setResendError(''); onResend().catch((e: unknown) => setResendError(e instanceof Error ? e.message : 'Нет связи с сервером')) }} />
          <button type="button" className="link" onClick={onBack}>Изменить данные</button>
        </div>
      </form>
    </>
  )
}
