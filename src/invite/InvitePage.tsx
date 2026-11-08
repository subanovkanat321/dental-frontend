import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, forgetInviteCode, inviteCode, inviteInfo, inviteRegister, type InviteCodeStep } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { Loading } from '../layout/Loading'
import { NewPasswordFields } from '../layout/PasswordFields'
import { useCountdown } from '../lib/otp'
import { passwordProblem } from '../lib/password'

type Done = { fullName: string; roleText: string }

const RENEW = 'Попросите руководителя клиники прислать новую ссылку.'

/** Код из адреса: «/invite#join_abc» → «join_abc». Во фрагменте — он не уходит на сервер с открытием страницы. */
function inviteToken(hash = window.location.hash): string {
  const t = hash.replace(/^#\/?/, '')
  return /^(join|staff)_[A-Za-z0-9_-]{1,64}$/.test(t) ? t : ''
}

/**
 * Страница по ссылке-приглашению {@code /invite#join_<код>} (врач) или {@code /invite#staff_<код>}
 * (сотрудник) — без входа. Главное — «Открыть в Telegram» (тот же старт у бота, что и раньше: «Начать» —
 * и готово). Ниже — мелкая ссылка «Нет Telegram? Зарегистрироваться по номеру телефона»: номер → код из
 * SMS и свой пароль → человек сразу в CRM (сессия от сервера, cookie). SMS на сервере не подключены
 * (codeRequired: false) — номер и пароль без кода. Код, номер и пароль — только в памяти страницы и в теле
 * запросов: не в localStorage и не в консоли. Шаг кода переживает перезагрузку: его помнит сервер
 * (HttpOnly-cookie), а код ссылки и так в адресе после «#».
 */
export function InvitePage() {
  const token = inviteToken()
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => inviteInfo(token), enabled: token !== '', retry: false, staleTime: Infinity })
  const [byPhone, setByPhone] = useState(false)
  const [done, setDone] = useState<Done | null>(null)

  let body: React.ReactNode
  if (done) body = <Welcome {...done} />
  else if (!token) body = <Invalid text={`Ссылка неполная или с ошибкой. ${RENEW}`} />
  else if (info.isPending) body = <Loading text="Проверяем приглашение…" />
  else if (info.error) {
    body = <Invalid text={info.error instanceof ApiError && info.error.status === 404 ? info.error.message
      : `${info.error.message || 'Нет связи с сервером'}. Обновите страницу через минуту.`} />
  } else {
    const i = info.data
    const tg = i.botUsername ? `https://t.me/${i.botUsername}?start=${token}` : null
    body = (
      <>
        <h1>Вас пригласили в Tish</h1>
        <p>Клиника: {i.clinicName}<br />{i.roleText[0]!.toUpperCase() + i.roleText.slice(1)}: <strong>{i.fullName}</strong></p>
        {tg && (
          <>
            <a className="btn tg-login" href={tg} target="_blank" rel="noopener noreferrer">Открыть в Telegram</a>
            <p className="hint">Нажмите «Начать» в боте — и вы в приложении.</p>
          </>
        )}
        {!byPhone && !i.pending ? (
          <button type="button" className="link invite-phone-link" onClick={() => setByPhone(true)}>
            {tg ? 'Нет Telegram? Зарегистрироваться по номеру телефона' : 'Зарегистрироваться по номеру телефона'}</button>
        ) : i.codeRequired ? <RegisterWithCode token={token} pending={i.pending} onDone={setDone} />
          : <Register token={token} onDone={setDone} />}
        <p className="hint small">Ссылка работает один раз и 24 часа.</p>
      </>
    )
  }
  return (
    <div className="center login invite-page">
      <div className="login-card">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={110} height={105} />
        {body}
      </div>
    </div>
  )
}

function Invalid({ text }: { text: string }) {
  return (
    <>
      <h1>Ссылка не работает</h1>
      <p className="error" role="alert">{text}</p>
      <p className="hint small">Уже зарегистрировались? <a href="/login">Войти по номеру и паролю</a></p>
    </>
  )
}

/**
 * SMS не подключены: номер, пароль и повтор — те же правила, что у «Придумайте пароль» при входе; последнее
 * слово — за сервером.
 */
function Register({ token, onDone }: { token: string; onDone: (d: Done) => void }) {
  const client = useQueryClient()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [check, setCheck] = useState('')
  const send = useMutation<{ fullName: string; roleText: string }, ApiError>({
    mutationFn: () => inviteRegister(token, { phone: phoneFromInput(phone), password }),
    onSuccess: (d) => {
      // Сессия уже в cookie — «кто я» спросим заново, когда откроют CRM
      void client.invalidateQueries({ queryKey: ['me'] })
      onDone(d)
    },
  })
  const e = send.error
  // 409 «номер занят» — тоже про номер: показать под полем, человек исправит и попробует снова
  const phoneError = e?.fieldErrors.phone ?? (e?.status === 409 ? e.message : undefined)
  const passwordError = check || e?.fieldErrors.password
  const other = e && !phoneError && !e.fieldErrors.password ? e.message : ''
  return (
    <form className="form narrow invite-form" aria-label="Регистрация по номеру" onSubmit={(ev) => {
      ev.preventDefault()
      const problem = passwordProblem(password, repeat, phoneFromInput(phone))
      setCheck(problem)
      if (!problem) send.mutate()
    }}>
      <p className="hint">Войти потом — на сайте по этому номеру и паролю. SMS не нужна.</p>
      <label className="field"><span>Номер телефона</span>
        <PhoneInput label="Ваш номер телефона" value={phone} onChange={setPhone} />
      </label>
      {phoneError && <p className="error">{phoneError}</p>}
      <NewPasswordFields password={password} repeat={repeat} phone={phoneFromInput(phone)} label="Придумайте пароль"
        onPassword={(v) => { setPassword(v); setCheck('') }} onRepeat={(v) => { setRepeat(v); setCheck('') }} />
      {passwordError && <p className="error">{passwordError}</p>}
      {other && <p className="error" role="alert">{other}</p>}
      <button type="submit" className="btn primary" disabled={send.isPending || !phone.trim()}>
        {send.isPending ? 'Регистрируем…' : 'Зарегистрироваться'}</button>
    </form>
  )
}

/**
 * С кодом из SMS — два шага, удобно на телефоне: «Номер» → «Получить код», затем код и «Придумайте пароль» на
 * одном экране → «Зарегистрироваться». Номер занят — сервер скажет до отправки SMS. После перезагрузки
 * страницы (pending от сервера) — сразу второй шаг: номер тогда только маской, набранного нет.
 */
function RegisterWithCode({ token, pending, onDone }: { token: string; pending: InviteCodeStep | null; onDone: (d: Done) => void }) {
  const client = useQueryClient()
  const [step, setStep] = useState<'phone' | 'code'>(pending ? 'code' : 'phone')
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState<InviteCodeStep | null>(pending)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [check, setCheck] = useState('')
  const [wait, restart] = useCountdown()
  useEffect(() => {
    // После перезагрузки — сколько осталось до «Отправить ещё раз» по словам сервера
    if (pending) restart(pending.resendSeconds)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии шага
  }, [])

  const getCode = useMutation<InviteCodeStep, ApiError, string>({
    mutationFn: (typed) => inviteCode(token, typed),
    onSuccess: (s) => {
      setSent(s)
      setCode('')
      restart(s.resendSeconds)
      setStep('code')
    },
    onError: (e) => {
      // «Отправить ещё раз», а сервер шаг уже забыл (5 минут вышли) — заново с номера
      if (step === 'code' && e.fieldErrors.phone) setStep('phone')
    },
  })
  const send = useMutation<Done, ApiError>({
    mutationFn: () => inviteRegister(token, { code, password }),
    onSuccess: (d) => {
      void client.invalidateQueries({ queryKey: ['me'] })
      onDone(d)
    },
  })

  if (step === 'phone') {
    const e = getCode.error
    const phoneError = e?.fieldErrors.phone ?? (e?.status === 409 ? e.message : undefined)
    const other = e && !phoneError ? e.message || 'Нет связи с сервером' : ''
    return (
      <form className="form narrow invite-form" aria-label="Регистрация по номеру" onSubmit={(ev) => {
        ev.preventDefault()
        getCode.mutate(phoneFromInput(phone))
      }}>
        <p className="hint">Пришлём SMS с кодом — так проверим, что номер ваш. Войти потом — на сайте по этому номеру и паролю.</p>
        <label className="field"><span>Номер телефона</span>
          <PhoneInput label="Ваш номер телефона" value={phone} onChange={setPhone} />
        </label>
        {phoneError && <p className="error">{phoneError}</p>}
        {other && <p className="error" role="alert">{other}</p>}
        <button type="submit" className="btn primary" disabled={getCode.isPending || !phone.trim()}>
          {getCode.isPending ? 'Отправляем…' : 'Получить код'}</button>
      </form>
    )
  }

  const e = send.error
  const codeError = e?.fieldErrors.code
  const passwordError = check || e?.fieldErrors.password
  const resendError = getCode.error ? getCode.error.message || 'Нет связи с сервером' : ''
  const other = e && !codeError && !e.fieldErrors.password ? e.message || 'Нет связи с сервером' : ''
  const typed = phone.trim() ? phoneFromInput(phone) : ''
  return (
    <form className="form narrow invite-form" aria-label="Код из SMS" onSubmit={(ev) => {
      ev.preventDefault()
      const problem = passwordProblem(password, repeat, typed)
      setCheck(problem)
      if (!problem) send.mutate()
    }}>
      <p className="hint" role="status">Отправили SMS с кодом{sent ? <> на <b>{sent.phoneMasked}</b></> : null}.
        Код действует {sent ? `${Math.max(1, Math.ceil(sent.secondsLeft / 60))} мин.` : '5 минут.'}</p>
      <CodeInput value={code} onChange={setCode} />
      {codeError && <p className="error">{codeError}</p>}
      <NewPasswordFields password={password} repeat={repeat} phone={typed} label="Придумайте пароль"
        onPassword={(v) => { setPassword(v); setCheck('') }} onRepeat={(v) => { setRepeat(v); setCheck('') }} />
      {passwordError && <p className="error">{passwordError}</p>}
      {other && <p className="error" role="alert">{other}</p>}
      <button type="submit" className="btn primary" disabled={send.isPending || code.length !== 6}>
        {send.isPending ? 'Регистрируем…' : 'Зарегистрироваться'}</button>
      {resendError && <p className="error" role="alert">{resendError}</p>}
      <div className="actions">
        <ResendLink wait={wait} sms={false} busy={getCode.isPending} onSms={() => getCode.mutate(typed)}
          onAgain={() => getCode.mutate(typed)} />
        <button type="button" className="link" onClick={() => {
          void forgetInviteCode().catch(() => undefined)
          getCode.reset()
          send.reset()
          setCode('')
          setStep('phone')
        }}>Другой номер</button>
      </div>
    </form>
  )
}

function Welcome({ fullName, roleText }: { fullName: string; roleText: string }) {
  return (
    <>
      <h1>Добро пожаловать{fullName ? `, ${fullName}` : ''}!</h1>
      <p role="status">Вы {roleText ? `${roleText} ` : ''}в Tish. Входите на сайте по номеру телефона и паролю.</p>
      <a className="btn primary" href="/">Открыть Tish</a>
      <p className="hint">📲 Установите Tish на телефон: <a href="/app">tish.kg/app</a> — как приложение, со своим значком.</p>
    </>
  )
}
