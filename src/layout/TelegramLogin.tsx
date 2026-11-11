import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, forgetTelegramLogin, startTelegramLogin, telegramLoginStatus } from '../api/client'
import { Spinner } from './Loading'

/** Как часто спрашиваем сервер, пока ждём «Подтвердить вход» в боте. */
export const POLL_MS = 2000

type View =
  | { kind: 'checking' }
  | { kind: 'idle'; note?: string }
  | { kind: 'waiting'; link: string }

/**
 * «Войти через Telegram» — для сотрудника, который работает в Tish через Telegram и не задавал номер или
 * пароль. Кнопка → сервер даёт одноразовую ссылку в бота (и HttpOnly-cookie этого браузера) → открываем
 * Telegram → бот спрашивает «Это вы входите прямо сейчас?» → «✅ Подтвердить вход» → опрос раз в 2 секунды
 * получает сессию → в CRM.
 * <p>
 * Ожидание переживает перезагрузку: на iPhone вкладка или PWA выгружается, пока человек в Telegram. При
 * открытии экран спрашивает сервер — тот помнит вход по cookie и снова отдаёт ссылку. Ссылку не храним ни
 * в адресе, ни в localStorage. Внутри Telegram (Mini App) кнопки нет — там вход и так через Telegram
 * (решает Login).
 *
 * @param onWaiting ждём подтверждения — Login прячет форму номера и пароля, чтобы не путать
 */
export function TelegramLogin({ onDone, onWaiting }: { onDone: () => void; onWaiting?: (waiting: boolean) => void }) {
  const [view, setView] = useState<View>({ kind: 'checking' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Свежий onDone — в ref (из эффекта): опрос не перезапускается, если Login перерисовался
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

  /** Ответ сервера → экран. @return ждём ли дальше */
  const apply = useCallback((s: Awaited<ReturnType<typeof telegramLoginStatus>>, wasWaiting: boolean) => {
    if (s.state === 'done') {
      done.current()
      return false
    }
    if (s.state === 'waiting' && s.link) {
      setView({ kind: 'waiting', link: s.link })
      return true
    }
    if (s.state === 'cancelled') setView({ kind: 'idle', note: 'Вход отменён в Telegram.' })
    else setView({ kind: 'idle', note: wasWaiting ? 'Время на подтверждение вышло — нажмите «Войти через Telegram» ещё раз.' : undefined })
    return false
  }, [])

  // При открытии экрана: может, уже ждём (страницу перезагрузили, пока человек был в Telegram)
  useEffect(() => {
    let alive = true
    telegramLoginStatus()
      .then((s) => { if (alive) apply(s, false) })
      .catch(() => { if (alive) setView({ kind: 'idle' }) })
    return () => { alive = false }
  }, [apply])

  const waiting = view.kind === 'waiting'
  useEffect(() => { onWaiting?.(waiting) }, [waiting, onWaiting])

  // Пока ждём — опрос раз в 2 секунды; вернулись во вкладку — сразу, не дожидаясь таймера
  useEffect(() => {
    if (!waiting) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      clearTimeout(timer)
      let more = true
      try {
        const s = await telegramLoginStatus()
        if (!alive) return
        more = apply(s, true)
      } catch {
        // Нет связи на секунду — спросим снова
      }
      if (alive && more) timer = setTimeout(() => void poll(), POLL_MS)
    }
    timer = setTimeout(() => void poll(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [waiting, apply])

  const start = async () => {
    setError('')
    setBusy(true)
    try {
      const started = await startTelegramLogin()
      setView({ kind: 'waiting', link: started.link })
      // Браузер мог не дать открыть окно после запроса — тогда под текстом кнопка-ссылка «Открыть Telegram»
      try {
        window.open(started.link, '_blank', 'noopener')
      } catch {
        // открытие окна запрещено — остаётся ссылка
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 0 ? e.message : 'Нет связи с сервером')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    void forgetTelegramLogin().catch(() => undefined)
    setView({ kind: 'idle' })
  }

  if (view.kind === 'checking') return null

  if (view.kind === 'waiting') {
    return (
      <div className="telegram-login waiting" role="status" aria-label="Ждём подтверждения в Telegram">
        <p><Spinner />Откройте Telegram и нажмите «Подтвердить вход».</p>
        <a className="btn tg-login" href={view.link} target="_blank" rel="noopener noreferrer">Открыть Telegram</a>
        <p className="hint small">Бот Tish спросит, вы ли это входите. Эта страница откроется сама.</p>
        <button type="button" className="link" onClick={cancel}>Отмена</button>
      </div>
    )
  }

  return (
    <div className="telegram-login">
      <button type="button" className="btn tg-login" disabled={busy} onClick={() => void start()}>
        {busy ? <><Spinner />Открываем…</> : 'Войти через Telegram'}</button>
      {view.note && <p className="hint" role="status">{view.note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint small">Быстрее всего: без номера и пароля — нажмите «Подтвердить вход» в боте Tish, и вы сразу в приложении.</p>
    </div>
  )
}
