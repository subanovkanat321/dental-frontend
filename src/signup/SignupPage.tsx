import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  api, ApiError, forgetSignup, signupAvailability, signupClinics, signupEmailCode, signupEmailStatus, signupEnterTelegram,
  signupInvitedClinic, signupRegister, signupTelegram, signupTelegramStatus, type SignupClinic, type SignupEmailSent, type SignupEmailWaiting, type SignupForm,
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
import { InAppHint } from './InAppHint'
import { useQrScreen } from '../lib/qrScreen'
import { useCountdown } from '../lib/otp'
import { passwordProblem } from '../lib/password'
import { clearCodeSent, markCodeSent, recentCodeSent } from './codeMark'
import { NextSteps } from './NextSteps'
import { dropInviteFromUrl, inviteFromUrl, refFromUrl, signupFromUrl } from '../lib/referral'

/** Как часто спрашиваем сервер, пока ждём «✅ Да, это я» в боте. */
export const POLL_MS = 2000

/** Письмо в «Спаме»: Gmail выключает там ссылки — «Не спам» или код. То же — первой строкой в самом письме. */
export const SPAM_HINT = 'Письмо в «Спаме»? Нажмите «Не спам» — тогда кнопка заработает. Или просто введите код.'

/** 409 сервера: номер уже у сотрудника клиники или с него уже зарегистрирована клиника — тогда «Войти». */
const PHONE_TAKEN = 'phone-in-clinic'

/** 409 сервера: клиника из списка уже подключена к Tish или пропала из списка. */
const LEAD_CODES = ['lead-in-tish', 'lead-gone']

/** Сколько букв нужно для поиска клиники (как на сервере). */
export const MIN_SEARCH = 3

/**
 * Шаг 1 «Найдите свою клинику»: ищем в списке 2ГИС; выбрали — форма с подставленными полями; «заполнить вручную» —
 * пустая форма, как раньше. Личная ссылка из сообщения клинике (/start?k=…) выбирает клинику сама.
 */
type Pick = { kind: 'search' } | { kind: 'manual' } | { kind: 'lead'; lead: SignupClinic }

type Step =
  | { kind: 'form' }
  | { kind: 'email'; sent: SignupEmailSent }
  /** страницу перезагрузили, cookie шага жива — снова «Код из письма» (формы в памяти уже нет) */
  | { kind: 'emailAgain'; waiting: SignupEmailWaiting }
  | { kind: 'telegram'; link: string }
  | { kind: 'creating'; text: string }
  | { kind: 'next'; clinicName: string }

/**
 * «Начать бесплатно» — клиника регистрируется сама (/start), без заявки и звонка. Один экран формы:
 * название клиники (или своё имя, если работаете один), город, имя, телефон, согласие. Выбора «частный врач /
 * клиника» нет: и там, и там регистрируется один человек и добавляет коллег сам. Подтвердить, что
 * это вы, — кнопкой «✅ Да, это я» в боте Telegram или письмом на почту (решение владельца 2026-11-27: только Telegram
 * или почта; что включено на сервере — GET /web/signup). Сервер сразу заводит клинику и даёт сессию: человек в CRM руководителем
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
 * того же письма можно ввести и здесь. SMS для регистрации убраны (2026-11-27).
 * После регистрации по почте — экран «Что дальше» (NextSteps): как входить потом и «Подключить Telegram».
 * <p>
 * Шаг кода из письма держит HttpOnly-cookie: перезагрузили страницу — сервер говорит, что форма ждёт, и страница снова
 * на шаге кода (спрашиваем, только если с этого устройства недавно отправляли код — метка codeMark, без ПДн). Встроенный
 * браузер Instagram, закрывшись, теряет и cookie — поэтому там над формой InAppHint: «откройте в Chrome / Safari»
 * (владелец 2026-11-27 отказался от «Уже есть код из письма?»).
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
  const [emailMode, setEmailMode] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const qr = useQrScreen()
  const [qrBusy, setQrBusy] = useState(false)
  const [pick, setPick] = useState<Pick>({ kind: 'search' })
  /** С этого устройства недавно отправляли код на почту, а шаг не восстановился — подсказка над формой. */

  useEffect(() => { document.title = 'Подключить Tish бесплатно' }, [])

  // Пришли по ссылке-приглашению другой клиники (/join?ref=… → /start?ref=…): код уходит с формой, сверху — кто пригласил
  const [ref] = useState(() => refFromUrl())
  // Откуда пришли (tish.kg/ig → /start?from=instagram): метка уходит с формой — регистрация посчитается по каналу
  const [from] = useState(() => signupFromUrl())
  // Личная ссылка из нашего сообщения клинике (/start?k=…): клиника сразу выбрана и форма заполнена. Код — из адреса в
  // память страницы, адрес — сразу без него (история браузера, Referer); серверу — в теле запроса
  const [inviteToken] = useState(() => inviteFromUrl())
  const [invitedPending, setInvitedPending] = useState(() => Boolean(inviteToken))
  /** Клиника по ссылке уже в Tish — подсказка над поиском. */
  const [invitedInTish, setInvitedInTish] = useState<SignupClinic | null>(null)
  useEffect(() => {
    dropInviteFromUrl()
    if (!inviteToken) return
    let live = true
    // Нашли и клиника ещё не в Tish — сразу «Ваша клиника» (можно нажать «Не моя клиника»); 404, ошибка — обычный поиск
    signupInvitedClinic(inviteToken).then((found) => {
      if (!live || !found) return
      if (found.alreadyInTish) setInvitedInTish(found)
      else setPick((p) => (p.kind === 'search' ? { kind: 'lead', lead: found } : p))
    }, () => {}).finally(() => { if (live) setInvitedPending(false) })
    return () => { live = false }
  }, [inviteToken])
  const invite = useQuery({
    queryKey: ['referral-invite', ref], enabled: Boolean(ref), retry: false, staleTime: Infinity,
    queryFn: async () => (await api.GET('/web/referral', { params: { query: { code: ref ?? '' } } })).data ?? null,
  })

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

  // Недавно отправляли код на почту: может, шаг кода ещё жив (cookie) — тогда снова он
  useEffect(() => {
    if (!recentCodeSent()) return
    let alive = true
    signupEmailStatus()
      .then((s) => {
        if (alive && s.state === 'waiting') setStep((prev) => prev.kind === 'form' ? { kind: 'emailAgain', waiting: s } : prev)
      })
      .catch(() => undefined)
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
      // Клиника из 2ГИС: сервер сам перенесёт её ссылку и телефон в «О клинике» — отправляем только номер и адрес
      ...(pick.kind === 'lead' ? { leadId: pick.lead.id, address: field('address') } : {}),
      ...(ref ? { ref } : {}),
      ...(from ? { from } : {}),
    }
  }

  const start = async (how: 'TELEGRAM' | 'EMAIL') => {
    const f = read()
    setForm(f)
    setError(null)
    setBusy(true)
    try {
      if (how === 'EMAIL') {
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
      setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
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
  else if (step.kind === 'telegram') {
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
    const w = ways.data ?? { telegram: false, email: false }
    const e = error
    const err = (k: string) => e?.fieldErrors[k] && <p className="error">{e.fieldErrors[k]}</p>
    const taken = e?.status === 409 && e.code === PHONE_TAKEN
    const leadProblem = e?.status === 409 && LEAD_CODES.includes(e.code ?? '')
    const other = e && !Object.keys(e.fieldErrors).length ? e.message : ''
    const lead = pick.kind === 'lead' ? pick.lead : null
    const toSearch = () => { setError(null); setPick({ kind: 'search' }) }
    formBody = (
      <div className="signup-step" hidden={step.kind !== 'form'}>
        <h1>Подключить Tish бесплатно</h1>
        {inApp && <InAppHint app={inApp.app} os={inApp.os} />}
        {invite.data && (
          <p className="tone-ok signup-invite" role="note">🎁 Вас пригласила клиника «{invite.data.clinicName}»</p>
        )}
        <p className="hint">Tish бесплатный: всё приложение, без оплаты, пробного срока и ограничений. Клиника — за пару минут, без заявки и звонка.</p>
        {!w.telegram && !w.email && <p className="error" role="alert">Регистрация сейчас недоступна — напишите нам, подключим вручную.</p>}
        {pick.kind === 'search' && invitedPending && <p className="hint" role="status"><Spinner />Открываем вашу клинику…</p>}
        {pick.kind === 'search' && invitedInTish && (
          <p className="tone-ok" role="note">«{invitedInTish.name}» уже в Tish — попросите доступ у руководителя клиники или <a href="/login">войдите</a>.</p>
        )}
        {pick.kind === 'search' && !invitedPending && (
          <ClinicSearch onPick={(found) => { setError(null); setPick({ kind: 'lead', lead: found }) }}
            onManual={() => { setError(null); setPick({ kind: 'manual' }) }} />
        )}
        {lead && (
          <div className="signup-picked" role="note" aria-label="Ваша клиника">
            <span className="signup-picked-label">Ваша клиника из 2ГИС</span>
            <b>{lead.name}</b>
            {(lead.address || lead.city) && <span className="hint small">{[lead.address, lead.city].filter(Boolean).join(' · ')}</span>}
            <p className="hint small">Адрес, телефон и ссылку 2ГИС перенесём в «О клинике» — проверьте поля ниже.</p>
            <button type="button" className="link" onClick={toSearch}>Не моя клиника</button>
          </div>
        )}
        {pick.kind === 'manual' && (
          <button type="button" className="link signup-alt signup-back-search" onClick={toSearch}>← Найти свою клинику в списке</button>
        )}
        {pick.kind !== 'search' && <form key={lead ? `lead-${lead.id}` : 'manual'} ref={formRef} className="form narrow invite-form signup-form" aria-label="Регистрация клиники"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault()
            void start(emailMode || !w.telegram ? 'EMAIL' : 'TELEGRAM')
          }}>
          <label className="field"><span>Название клиники</span>
            <input name="clinicName" maxLength={100} autoComplete="off" placeholder="Стоматология «Улыбка»" aria-describedby="signup-clinic-hint"
              defaultValue={lead?.name ?? ''} /></label>
          {!lead && <p id="signup-clinic-hint" className="hint small field-note">или ваше имя, если работаете один</p>}
          {err('clinicName')}
          <label className="field"><span>Город</span>
            <Select name="city" defaultValue={cityOption(lead?.city)}>
              <option value="">Выберите город</option>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="Другой">Другой город</option>
            </Select></label>
          {err('city')}
          {lead && (
            <>
              <label className="field"><span>Адрес</span>
                <input name="address" maxLength={200} autoComplete="off" placeholder="ул. Токтогула, 100" defaultValue={lead.address ?? ''} /></label>
              {err('address')}
            </>
          )}
          <label className="field"><span>Ваше имя</span>
            <input name="fullName" maxLength={100} autoComplete="off" placeholder="Айгерим Садыкова" /></label>
          {err('fullName')}
          <label className="field"><span>Ваш телефон</span><PhoneInput label="Ваш телефон" value={phone} onChange={setPhone} /></label>
          {err('phone')}
          <label className="check"><input type="checkbox" name="consent" /> Согласен(на) с условиями Tish и с тем, что мои имя и телефон
            используются для работы аккаунта клиники</label>
          {err('consent')}
          {taken && <p className="error" role="alert">{e.message}. <a href="/login">Войти в Tish</a></p>}
          {!taken && other && <p className="error" role="alert">{other}{leadProblem && <>{' '}
            <button type="button" className="link" onClick={toSearch}>Выбрать другую</button></>}</p>}
          {w.telegram && (
            <button type={emailMode ? 'button' : 'submit'} className="btn tg-login" disabled={busy}
              onClick={emailMode ? () => void start('TELEGRAM') : undefined}>
              {busy && !emailMode ? <><Spinner />Проверяем…</> : 'Подтвердить через Telegram'}</button>
          )}
          {w.telegram && inApp && (
            <p className="hint small signup-tg-hint">Через Telegram удобнее: Tish останется у вас в Telegram — кнопка «Открыть день»</p>
          )}
          {w.email && (emailMode || !w.telegram) && (
            <>
              <label className="field"><span>Почта</span>
                <input name="email" type="email" inputMode="email" maxLength={254} autoComplete="email" placeholder="name@gmail.com" /></label>
              {err('email')}
              <button type={w.telegram ? 'button' : 'submit'} className={w.telegram ? 'btn' : 'btn primary'} disabled={busy}
                onClick={w.telegram ? () => void start('EMAIL') : undefined}>
                {busy ? <><Spinner />Отправляем…</> : 'Получить письмо'}</button>
            </>
          )}
          {w.email && w.telegram && !emailMode && (
            <button type="button" className="link signup-alt" onClick={() => setEmailMode(true)}>или подтвердить по почте</button>
          )}
        </form>}
        <p className="hint small">Уже в Tish? <a href="/login">Войти</a> · Нужна помощь с подключением? <a href="/join#form">Оставьте заявку</a></p>
      </div>
    )
  }
  return (
    // Ноутбук (≥900px) — как вход сотрудника: слева Тишка и коротко о Tish, справа форма; телефон — одной колонкой (crm.css)
    <div className="center login invite-page signup-page staff-login">
      <div className="login-card">
        <div className="login-intro">
          <a href="/about" aria-label="О Tish"><img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={96} height={92} /></a>
          <p className="login-lead">Tish бесплатный: онлайн-запись пациентов, расписание, медкарта, касса и склад. Клиника готова за 5 минут —
            с телефона или компьютера.</p>
          <a className="login-about" href="/about">Подробнее о Tish →</a>
        </div>
        <div className="login-main">
          {body}
          {formBody}
        </div>
      </div>
    </div>
  )
}

/** Шаг «Код из письма»: код и «Придумайте пароль» (по номеру и паролю — вход потом) → «Создать клинику». */
function CodeStepForm({ form, sent, busy, error, onBack, onResend, onSubmit, title = 'Код из письма', intro, note }: {
  form: SignupForm; sent: { secondsLeft: number; resendSeconds: number }; busy: boolean; error: ApiError | null
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
        <p className="hint" role="status">{intro} Код действует {Math.max(1, Math.ceil(sent.secondsLeft / 60))} мин.</p>
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
          {onResend && <ResendLink wait={wait} busy={busy} onAgain={() => { setResendError(''); onResend().catch((e: unknown) => setResendError(e instanceof Error ? e.message : 'Нет связи с сервером')) }} />}
          <button type="button" className="link" onClick={onBack}>Изменить данные</button>
        </div>
      </form>
    </>
  )
}

/** Город клиники из 2ГИС — пункт списка городов; не из списка — «Другой город»; нет — «Выберите город». */
function cityOption(city?: string | null): string {
  if (!city) return ''
  const known = CITIES.find((c) => c.toLowerCase() === city.trim().toLowerCase())
  return known ?? 'Другой'
}

/**
 * Шаг 1 «Найдите свою клинику»: от 3 букв названия или адреса (латиницей тоже) — до 8 клиник из списка 2ГИС, через
 * 300 мс после последней буквы. Уже подключённая — без кнопки, с «Уже в Tish — попросите доступ у руководителя клиники».
 * Поле — без value (как форма ниже: во встроенном браузере Instagram клавиатура не любит перерисовок поля).
 */
function ClinicSearch({ onPick, onManual }: { onPick: (clinic: SignupClinic) => void; onManual: () => void }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim().replace(/\s+/g, ' ')), 300)
    return () => clearTimeout(timer)
  }, [text])
  const enough = query.replace(/ /g, '').length >= MIN_SEARCH
  const found = useQuery({
    queryKey: ['signup-clinics', query], enabled: enough, retry: false, staleTime: 60_000,
    queryFn: () => signupClinics(query),
  })
  const list = enough ? found.data ?? [] : []
  return (
    <section className="signup-search" aria-label="Найдите свою клинику">
      <h2>Найдите свою клинику</h2>
      <label className="field"><span>Название или адрес</span>
        <input type="search" name="clinicSearch" maxLength={100} autoComplete="off" enterKeyHint="search"
          placeholder="Например, «Улыбка» или «Токтогула»" onChange={(ev) => setText(ev.target.value)} /></label>
      {!enough && <p className="hint small">Введите хотя бы {MIN_SEARCH} буквы — покажем клиники из 2ГИС</p>}
      {enough && found.isFetching && !found.data && <p className="hint small" role="status"><Spinner />Ищем…</p>}
      {enough && found.error && (
        <p className="error" role="alert">{found.error instanceof ApiError ? found.error.message : 'Нет связи с сервером'}</p>
      )}
      {enough && found.isSuccess && list.length === 0 && (
        <p className="hint" role="status">Не нашли «{query}». Попробуйте другое слово или заполните вручную.</p>
      )}
      {list.length > 0 && (
        <ul className="signup-clinics" aria-label="Найденные клиники">
          {list.map((c) => {
            const where = [c.address, c.city].filter(Boolean).join(' · ')
            return (
              <li key={c.id}>
                {c.alreadyInTish ? (
                  <div className="signup-clinic in-tish" aria-label={c.name}>
                    <b>{c.name}</b>
                    {where && <span className="signup-clinic-where">{where}</span>}
                    <span className="tone-ok signup-clinic-note">Уже в Tish — попросите доступ у руководителя клиники</span>
                  </div>
                ) : (
                  <button type="button" className="signup-clinic" onClick={() => onPick(c)}>
                    <b>{c.name}</b>
                    {where && <span className="signup-clinic-where">{where}</span>}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className="btn signup-manual" onClick={onManual}>Моей клиники нет — заполнить вручную</button>
    </section>
  )
}
