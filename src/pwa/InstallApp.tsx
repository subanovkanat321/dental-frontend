import { useState } from 'react'

import { telegram } from '../lib/telegram'
import { install, isIos, isStandalone, usePwa } from './pwa'
import './pwa.css'

/** Значок «Поделиться» Safari — квадрат со стрелкой вверх, как на iPhone. */
export function ShareIcon() {
  return (
    <svg className="pwa-share" aria-label="«Поделиться»" role="img" viewBox="0 0 24 24" width="18" height="18">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 3v12M8 7l4-4 4 4M7 10H5v11h14V10h-2" />
    </svg>
  )
}

/** Адрес для установки: вход CRM (корень без входа увёл бы на каталог клиник). */
function loginUrl(): string {
  return `${window.location.origin}/login`
}

/**
 * «Настройки → Установить приложение»: CRM на экран телефона или компьютера, как программа —
 * своё окно без адресной строки, значок Тишки. Как именно — зависит от того, где открыта.
 */
export function InstallApp() {
  const { prompt, installed } = usePwa()
  const [copied, setCopied] = useState(false)
  const app = telegram()
  let body
  if (app) {
    const copy = () => {
      navigator.clipboard?.writeText(loginUrl()).then(() => setCopied(true), () => setCopied(false))
    }
    body = (
      <>
        <p>Из Telegram приложение не установить. Откройте <strong>{window.location.host}</strong> в браузере телефона
          (Chrome или Safari), войдите и установите оттуда — здесь же, в «Настройках».</p>
        <div className="actions">
          {app.openLink && <button type="button" className="btn primary" onClick={() => app.openLink!(loginUrl())}>Открыть в браузере</button>}
          <button type="button" className="btn" onClick={copy}>{copied ? 'Ссылка скопирована ✓' : 'Скопировать ссылку'}</button>
        </div>
      </>
    )
  } else if (installed || isStandalone()) {
    body = <p className="pwa-ok">Приложение установлено ✓</p>
  } else if (prompt) {
    body = (
      <>
        <p>Tish откроется отдельным окном со своим значком — как обычная программа, без вкладок браузера.</p>
        <div className="actions"><button type="button" className="btn primary" onClick={() => void install()}>Установить</button></div>
      </>
    )
  } else if (isIos()) {
    body = (
      <ol className="pwa-steps">
        <li>Откройте этот сайт в <strong>Safari</strong>.</li>
        <li>Нажмите <ShareIcon /> <strong>Поделиться</strong> внизу экрана.</li>
        <li>Выберите <strong>На экран «Домой»</strong> → <strong>Добавить</strong>.</li>
      </ol>
    )
  } else {
    body = (
      <ul className="pwa-steps">
        <li>Android: меню <strong>⋮</strong> в Chrome → <strong>Установить приложение</strong> (или «Добавить на главный экран»).</li>
        <li>Компьютер: значок установки справа в адресной строке Chrome или Edge, или меню <strong>⋮</strong> → «Установить Tish CRM».</li>
      </ul>
    )
  }
  return (
    <section className="settings-group" aria-label="Установить приложение">
      <h2>📲 Установить приложение</h2>
      <div className="card-block pwa-install">{body}</div>
    </section>
  )
}
