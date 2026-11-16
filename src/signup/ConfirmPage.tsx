import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, signupEmailConfirm, signupEmailLink } from '../api/client'
import { Loading, Spinner } from '../layout/Loading'
import { NewPasswordFields } from '../layout/PasswordFields'
import { passwordProblem } from '../lib/password'
import { NextSteps } from './NextSteps'

/** Токен из адреса — один раз при открытии; адрес сразу без него (не остаётся в истории браузера). */
function takeToken(): string {
  const token = new URLSearchParams(window.location.search).get('t') ?? ''
  if (window.location.search) window.history.replaceState(null, '', '/start/confirm')
  return token
}

/**
 * /start/confirm?t=… — «Подтвердить и открыть Tish» из письма регистрации. Ссылку открывают из почты (Gmail, «Почта»)
 * — уже в настоящем браузере, поэтому пароль придумывают здесь, а не во встроенном браузере Instagram: вход сохранится
 * тут. Токен — из адреса в память страницы, адрес сразу без него; серверу — в теле запроса. Ссылка жива — «Почта
 * подтверждена», название клиники и номер маской, «Придумайте пароль» → «Создать клинику» → сразу вход и «Что дальше».
 * Устарела или уже использована — «Ссылка устарела» и кнопка на /start.
 *
 * @param onDone «Перейти в Tish» (по умолчанию — CRM)
 */
export function ConfirmPage({ onDone = () => window.location.assign('/') }: { onDone?: () => void }) {
  const client = useQueryClient()
  const [token] = useState(takeToken)
  const preview = useQuery({ queryKey: ['signup-link'], queryFn: () => signupEmailLink(token), retry: false, staleTime: Infinity, enabled: !!token })
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [check, setCheck] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => { document.title = 'Подтверждение почты — Tish' }, [])

  const create = async () => {
    const problem = passwordProblem(password, repeat, '')
    setCheck(problem)
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      const registered = await signupEmailConfirm(token, password)
      void client.invalidateQueries({ queryKey: ['me'] })
      setDone(registered.clinicName || preview.data?.clinicName || '')
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Нет связи с сервером'))
    } finally {
      setBusy(false)
    }
  }

  let body: React.ReactNode
  const stale = !token || preview.error instanceof ApiError && preview.error.status === 404 || error?.status === 404
  if (done !== null) body = <NextSteps clinicName={done} onDone={onDone} />
  else if (stale) {
    body = (
      <div className="signup-step">
        <h1>Ссылка устарела</h1>
        <p className="hint">Ссылка из письма действует 30 минут и только один раз. Зарегистрируйтесь ещё раз — это пара минут.</p>
        <a className="btn primary" href="/start">Зарегистрироваться</a>
        <p className="hint small">Уже создали клинику? <a href="/login">Войти</a></p>
      </div>
    )
  } else if (preview.isPending) body = <Loading text="Проверяем ссылку…" />
  else if (preview.error) {
    body = (
      <div className="signup-step">
        <h1>Не получилось проверить ссылку</h1>
        <p className="error" role="alert">{preview.error.message}</p>
        <button type="button" className="btn" onClick={() => void preview.refetch()}>Попробовать ещё раз</button>
      </div>
    )
  } else {
    const passwordError = check || error?.fieldErrors.password
    const other = error && !error.fieldErrors.password ? error.message : ''
    body = (
      <div className="signup-step">
        <h1>Почта подтверждена</h1>
        <p className="hint">{preview.data.clinicName}, телефон {preview.data.phoneMasked}. Придумайте пароль — с ним и номером
          входите в Tish на любом устройстве.</p>
        <form className="form narrow invite-form" aria-label="Пароль для входа" onSubmit={(ev) => { ev.preventDefault(); void create() }}>
          <NewPasswordFields password={password} repeat={repeat} phone="" label="Придумайте пароль для входа"
            onPassword={(v) => { setPassword(v); setCheck('') }} onRepeat={(v) => { setRepeat(v); setCheck('') }} />
          {passwordError && <p className="error">{passwordError}</p>}
          {other && <p className="error" role="alert">{other}</p>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner />Создаём…</> : 'Создать клинику'}</button>
        </form>
      </div>
    )
  }
  return (
    <div className="center login invite-page signup-page">
      <div className="login-card">
        <a href="/about" aria-label="О Tish"><img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={96} height={92} /></a>
        {body}
      </div>
    </div>
  )
}
