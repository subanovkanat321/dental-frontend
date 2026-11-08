import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, inviteInfo, inviteRegister } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { Loading } from '../layout/Loading'
import { NewPasswordFields } from '../layout/PasswordFields'
import { passwordProblem } from '../lib/password'

const RENEW = 'Попросите руководителя клиники прислать новую ссылку.'

/** Код из адреса: «/invite#join_abc» → «join_abc». Во фрагменте — он не уходит на сервер с открытием страницы. */
function inviteToken(hash = window.location.hash): string {
  const t = hash.replace(/^#\/?/, '')
  return /^(join|staff)_[A-Za-z0-9_-]{1,64}$/.test(t) ? t : ''
}

/**
 * Страница по ссылке-приглашению {@code /invite#join_<код>} (врач) или {@code /invite#staff_<код>}
 * (сотрудник) — без входа. Главное — «Открыть в Telegram» (тот же старт у бота, что и раньше: «Начать» —
 * и готово). Ниже — мелкая ссылка «Нет Telegram? Зарегистрироваться по номеру телефона»: номер и свой
 * пароль → человек сразу в CRM (сессия от сервера, cookie). Код, номер и пароль — только в памяти
 * страницы и в теле запросов: не в localStorage и не в консоли.
 */
export function InvitePage() {
  const token = inviteToken()
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => inviteInfo(token), enabled: token !== '', retry: false, staleTime: Infinity })
  const [byPhone, setByPhone] = useState(false)
  const [done, setDone] = useState<{ fullName: string; roleText: string } | null>(null)

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
        {!byPhone ? (
          <button type="button" className="link invite-phone-link" onClick={() => setByPhone(true)}>
            {tg ? 'Нет Telegram? Зарегистрироваться по номеру телефона' : 'Зарегистрироваться по номеру телефона'}</button>
        ) : <Register token={token} onDone={setDone} />}
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

/** Номер, пароль и повтор — те же правила, что у «Придумайте пароль» при входе; последнее слово — за сервером. */
function Register({ token, onDone }: { token: string; onDone: (d: { fullName: string; roleText: string }) => void }) {
  const client = useQueryClient()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [check, setCheck] = useState('')
  const send = useMutation<{ fullName: string; roleText: string }, ApiError>({
    mutationFn: () => inviteRegister(token, phoneFromInput(phone), password),
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
