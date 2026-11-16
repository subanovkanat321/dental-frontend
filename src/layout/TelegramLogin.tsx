import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, forgetTelegramLogin, startTelegramLogin, telegramLoginStatus } from '../api/client'
import { useQrScreen } from '../lib/qrScreen'
import { Spinner } from './Loading'
import { LoginQr } from './LoginQr'

/** Как часто спрашиваем сервер, пока ждём «Подтвердить вход» в боте. */
export const POLL_MS = 2000

/** Сколько раз QR-код обновляется сам, когда истёк; дальше — кнопкой «Обновить код» (вкладку могли забыть открытой). */
const AUTO_REFRESH = 3

/** Подпись под QR-кодом — для компьютера без Telegram. */
export const QR_CAPTION = 'Нет Telegram на компьютере? Наведите камеру телефона на код → «Подтвердить вход» в боте — компьютер войдёт сам'

type View =
  | { kind: 'checking' }
  | { kind: 'idle'; note?: string }
  /** opened — человек нажал «Войти через Telegram» (ждём его); иначе ссылка только для QR-кода на компьютере */
  | { kind: 'waiting'; link: string; opened: boolean }

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
 * <p>
 * На компьютере (LoginQr, широкий экран с мышью) рядом с кнопкой — QR-код той же ссылки: на ноутбуке может не быть
 * Telegram. Ссылку для кода берём сразу при открытии экрана; телефон наводят на код, в боте «Подтвердить вход», а
 * ноутбук входит по своей cookie (номер входа к устройству или адресу не привязан — бот подтверждает по номеру).
 * Пока ссылка только для QR, форма номера и пароля остаётся видна. Код истёк — новый сам (до трёх раз, если
 * вкладка открыта) или кнопкой «Обновить код».
 *
 * @param onWaiting ждём подтверждения — Login прячет форму номера и пароля, чтобы не путать
 */
export function TelegramLogin({ onDone, onWaiting }: { onDone: () => void; onWaiting?: (waiting: boolean) => void }) {
  const [view, setView] = useState<View>({ kind: 'checking' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qrBusy, setQrBusy] = useState(false)
  const qr = useQrScreen()
  const autoLeft = useRef(AUTO_REFRESH)
  // Свежий onDone — в ref (из эффекта): опрос не перезапускается, если Login перерисовался
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

  /** Ответ сервера → экран. @return ждём ли дальше */
  const apply = useCallback((s: Awaited<ReturnType<typeof telegramLoginStatus>>, wasWaiting: boolean, opened: boolean) => {
    if (s.state === 'done') {
      done.current()
      return false
    }
    if (s.state === 'waiting' && s.link) {
      const link = s.link
      setView((v) => ({ kind: 'waiting', link, opened: v.kind === 'waiting' ? v.opened : opened }))
      return true
    }
    if (s.state === 'cancelled') setView({ kind: 'idle', note: 'Вход отменён в Telegram.' })
    else setView({ kind: 'idle', note: wasWaiting ? 'Время на подтверждение вышло — нажмите «Войти через Telegram» ещё раз.' : undefined })
    return false
  }, [])

  /** Новая ссылка для QR-кода — без окна Telegram и без «ждём вас» (форма номера остаётся). */
  const fresh = useCallback(async () => {
    setError('')
    setQrBusy(true)
    try {
      const started = await startTelegramLogin()
      setView({ kind: 'waiting', link: started.link, opened: false })
    } catch (e) {
      setView({ kind: 'idle' })
      // Код не взяли (лимит, нет связи) — под QR «Обновить код»; кнопка «Войти через Telegram» работает как прежде
      if (e instanceof ApiError && e.status !== 0) setError(e.message)
    } finally {
      setQrBusy(false)
    }
  }, [])
  const qrRef = useRef(qr)
  useEffect(() => { qrRef.current = qr }, [qr])

  // При открытии экрана: может, уже ждём (страницу перезагрузили, пока человек был в Telegram).
  // На компьютере сразу берём ссылку для QR-кода
  useEffect(() => {
    let alive = true
    telegramLoginStatus()
      .then((s) => {
        if (!alive) return
        // На телефоне перезагрузка во время ожидания — снова «ждём вас»; на компьютере — QR и форма номера
        if (!apply(s, false, !qrRef.current) && s.state === 'none' && qrRef.current) void fresh()
      })
      .catch(() => { if (alive) setView({ kind: 'idle' }) })
    return () => { alive = false }
  }, [apply, fresh])

  const polling = view.kind === 'waiting'
  const waiting = view.kind === 'waiting' && view.opened
  useEffect(() => { onWaiting?.(waiting) }, [waiting, onWaiting])

  // Пока ждём — опрос раз в 2 секунды; вернулись во вкладку — сразу, не дожидаясь таймера
  useEffect(() => {
    if (!polling) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      clearTimeout(timer)
      let more = true
      try {
        const s = await telegramLoginStatus()
        if (!alive) return
        more = apply(s, true, false)
        // Истёк код, который был только для QR, — новый сам, пока вкладку видно (не бесконечно)
        if (!more && s.state === 'none' && qrRef.current && autoLeft.current > 0 && document.visibilityState === 'visible') {
          autoLeft.current--
          void fresh()
        }
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
  }, [polling, apply, fresh])

  const start = async () => {
    // Ссылка для QR уже есть — её и открываем (сразу, в том же нажатии: так браузер не блокирует окно)
    if (view.kind === 'waiting') {
      setView({ ...view, opened: true })
      try {
        window.open(view.link, '_blank', 'noopener')
      } catch {
        // открытие окна запрещено — остаётся ссылка
      }
      return
    }
    setError('')
    setBusy(true)
    try {
      const started = await startTelegramLogin()
      setView({ kind: 'waiting', link: started.link, opened: true })
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
    // На компьютере ссылка ещё нужна QR-коду — просто перестаём ждать Telegram здесь
    if (qr && view.kind === 'waiting') {
      setView({ ...view, opened: false })
      return
    }
    void forgetTelegramLogin().catch(() => undefined)
    setView({ kind: 'idle' })
  }

  if (view.kind === 'checking') return null

  const refresh = () => {
    autoLeft.current = AUTO_REFRESH
    void fresh()
  }
  const code = qr && <LoginQr link={view.kind === 'waiting' ? view.link : null} busy={qrBusy} onRefresh={refresh} caption={QR_CAPTION} />

  if (view.kind === 'waiting' && view.opened) {
    return (
      <div className="telegram-login waiting" role="status" aria-label="Ждём подтверждения в Telegram">
        <p><Spinner />Откройте Telegram и нажмите «Подтвердить вход».</p>
        <a className="btn tg-login" href={view.link} target="_blank" rel="noopener noreferrer">Открыть Telegram</a>
        <p className="hint small">Бот Tish спросит, вы ли это входите. Эта страница откроется сама.</p>
        {code}
        <button type="button" className="link" onClick={cancel}>Отмена</button>
      </div>
    )
  }

  return (
    <div className="telegram-login">
      <button type="button" className="btn tg-login" disabled={busy} onClick={() => void start()}>
        {busy ? <><Spinner />Открываем…</> : 'Войти через Telegram'}</button>
      {view.kind === 'idle' && view.note && <p className="hint" role="status">{view.note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint small">Быстрее всего: без номера и пароля — нажмите «Подтвердить вход» в боте Tish, и вы сразу в приложении.</p>
      {code}
    </div>
  )
}
