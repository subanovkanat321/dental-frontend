import { useEffect, useState } from 'react'

import { ApiError, telegramConnectStart, telegramConnectStatus } from '../api/client'
import { Spinner } from '../layout/Loading'
import { chromeIntent, inAppBrowser } from '../lib/inAppBrowser'

/** Как часто спрашиваем сервер, пока ждём «✅ Да, это я» в боте. */
export const CONNECT_POLL_MS = 2000

/** Скопировать текст: clipboard API, а во встроенных браузерах, где его нет, — через выделение. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

/**
 * «Что дальше» — после регистрации клиники по почте, вместо мгновенного перехода в CRM. Врачи приходят из
 * Instagram: регистрируются во встроенном браузере, закрывают его — и не помнят, как вернуться (адреса нет, приложения
 * нет). Здесь — как заходить потом (tish.kg/login, номер и пароль) и «📲 Подключить Telegram» главной кнопкой: бот
 * пришлёт «Открыть день», Tish останется в Telegram. Во встроенном браузере — настойчивее: предупреждение сверху и
 * «Открыть в Chrome» (Android, intent://) или «⋯ → Открыть в браузере» (iPhone: Safari программно не открыть). Вне
 * него — «Поставить на экран телефона» (/app).
 * <p>
 * Ссылку в бота берём сразу при открытии экрана: кнопка — настоящая ссылка {@code <a>}, её открытие во встроенном
 * браузере не заблокируют как всплывающее окно после запроса. Подключили — сервер выдал новую cookie-сессию (у
 * старой прежний id), «Перейти в Tish» откроет CRM уже под Telegram.
 *
 * @param clinicName название клиники — в заголовке
 * @param onDone «Перейти в Tish» → CRM
 */
export function NextSteps({ clinicName, onDone, userAgent }: { clinicName?: string; onDone: () => void; userAgent?: string }) {
  const inApp = inAppBrowser(userAgent)
  const loginUrl = `${window.location.origin}/login`
  const loginText = loginUrl.replace(/^https?:\/\//, '')
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')
  const [link, setLink] = useState<string | null>(null)
  const [connectError, setConnectError] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [linked, setLinked] = useState(false)

  useEffect(() => { document.title = 'Клиника создана — Tish' }, [])

  useEffect(() => {
    let alive = true
    telegramConnectStart()
      .then((started) => { if (alive) setLink(started.link) })
      .catch((e: unknown) => { if (alive) setConnectError(e instanceof ApiError && e.status !== 409 ? e.message : '') })
    return () => { alive = false }
  }, [])

  // Нажали «Подключить Telegram» — ждём «✅ Да, это я»: раз в 2 секунды и сразу, когда вернулись во вкладку
  useEffect(() => {
    if (!waiting) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      clearTimeout(timer)
      try {
        const s = await telegramConnectStatus()
        if (!alive) return
        if (s.state === 'linked') {
          setLinked(true)
          setWaiting(false)
          return
        }
        if (s.state === 'failed' || s.state === 'cancelled') {
          setWaiting(false)
          setConnectError(s.state === 'failed' && s.error ? s.error : 'Подключение отменено в Telegram.')
          return
        }
      } catch {
        // Нет связи на секунду — спросим снова
      }
      if (alive) timer = setTimeout(() => void poll(), CONNECT_POLL_MS)
    }
    timer = setTimeout(() => void poll(), CONNECT_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [waiting])

  const copy = async () => setCopied(await copyText(loginUrl) ? 'ok' : 'fail')

  return (
    <div className="signup-next" aria-label="Что дальше">
      <h1>✅ Клиника создана</h1>
      {clinicName && <p className="hint">{clinicName} — уже ваша. Всё приложение, без ограничений.</p>}
      {inApp && (
        <p className="notice tone-wait signup-next-warn" role="note">
          Вы во встроенном браузере {inApp.app}: закроете {inApp.app} — и эта страница потеряется. Подключите Telegram
          или откройте Tish в {inApp.os === 'android' ? 'Chrome' : 'Safari'} — так Tish останется у вас.
        </p>
      )}

      <section className="signup-next-block">
        <p><b>Как заходить потом:</b> <a href="/login">{loginText}</a> — ваш номер и пароль, который вы придумали.</p>
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать ссылку</button>
        {copied === 'ok' && <p className="hint small" role="status">Ссылка скопирована — сохраните её в заметках или отправьте себе.</p>}
        {copied === 'fail' && <p className="hint small" role="status">Не получилось скопировать — запишите адрес: {loginText}</p>}
      </section>

      <section className="signup-next-block">
        {linked ? (
          <p className="tone-ok" role="status">✅ Telegram подключён — бот прислал «Открыть день». Tish теперь у вас в Telegram.</p>
        ) : (
          <>
            {link
              ? <a className="btn tg-login" href={link} target="_blank" rel="noopener noreferrer" onClick={() => { setConnectError(''); setWaiting(true) }}>📲 Подключить Telegram</a>
              : !connectError && <button type="button" className="btn tg-login" disabled><Spinner />Подключить Telegram</button>}
            <p className="hint small">Бот Tish пришлёт кнопку «Открыть день» — Tish всегда под рукой в Telegram, адрес помнить не нужно.</p>
            {waiting && <p className="hint" role="status"><Spinner />Ждём «✅ Да, это я» в Telegram…</p>}
            {connectError && <p className="error" role="alert">{connectError}</p>}
          </>
        )}
      </section>

      {inApp?.os === 'android' && (
        <a className="btn" href={chromeIntent(loginUrl)}>Открыть в Chrome</a>
      )}
      {inApp && inApp.os !== 'android' && (
        <p className="hint signup-next-ios">Открыть в Safari: нажмите <b>⋯</b> вверху справа → «Открыть в браузере» (или скопируйте ссылку выше и вставьте в Safari).</p>
      )}
      {!inApp && <a className="link" href="/app">📲 Поставить на экран телефона</a>}

      <button type="button" className={inApp ? 'btn' : 'btn primary'} onClick={onDone}>Перейти в Tish</button>
    </div>
  )
}
