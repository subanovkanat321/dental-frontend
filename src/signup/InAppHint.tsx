import { useState } from 'react'

import { chromeIntent, type InAppBrowser } from '../lib/inAppBrowser'

/**
 * /start открыли из Instagram (Facebook, TikTok, Threads): встроенный браузер забывает вход и шаг регистрации, как только
 * приложение закрыть. Поэтому сразу над формой — открыть страницу в настоящем браузере (владелец 2026-11-27): на Android —
 * кнопкой в Chrome (intent://), на iPhone Safari программно не открыть — «⋯ → Открыть в браузере» или скопировать ссылку.
 */
export function InAppHint({ app, os }: InAppBrowser) {
  const [copied, setCopied] = useState(false)
  const url = window.location.href
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => undefined)
  }
  return (
    <div className="tone-wait signup-inapp" role="note">
      <p><strong>Откройте в браузере</strong> — вы в {app}: когда его закроете, регистрация и вход пропадут.</p>
      {os === 'android' ? (
        <a className="btn primary" href={chromeIntent(url)}>Открыть в Chrome</a>
      ) : (
        <>
          <p>Нажмите <b>⋯</b> вверху справа → «Открыть в {os === 'ios' ? 'Safari' : 'браузере'}» {os === 'ios' && '(или «Открыть во внешнем браузере»)'}.</p>
          <button type="button" className="btn" onClick={copy}>{copied ? '✓ Ссылка скопирована — вставьте в Safari или Chrome' : 'Скопировать ссылку'}</button>
        </>
      )}
    </div>
  )
}
