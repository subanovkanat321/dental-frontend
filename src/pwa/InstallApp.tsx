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

/** Три точки «⋯» в круге — кнопка меню нового Safari (iOS 26) внизу справа. */
function MoreIcon() {
  return <span className="pwa-more" role="img" aria-label="«⋯»">⋯</span>
}

/**
 * iPhone, Safari. В iOS 26 значка «Поделиться» внизу нет — он в меню «⋯» справа от адреса;
 * в старых iOS — сразу внизу посередине. Рисуем нижнюю полосу Safari, чтобы было видно, куда жать.
 */
function IosSteps() {
  return (
    <>
      <div className="pwa-safari" aria-hidden="true">
        <span className="pwa-safari-btn">‹</span>
        <span className="pwa-safari-url">{window.location.host}</span>
        <span className="pwa-safari-btn hot">⋯<span className="pwa-safari-tap">нажмите</span></span>
      </div>
      <ol className="pwa-steps">
        <li>В <strong>Safari</strong> нажмите <MoreIcon /> <strong>внизу справа</strong>, рядом с адресом {window.location.host}.</li>
        <li>Выберите <ShareIcon /> <strong>Поделиться</strong>.<br />
          <span className="hint">В старых iPhone значок <ShareIcon /> сразу внизу посередине экрана — нажмите его.</span></li>
        <li>Пролистайте вниз и выберите <strong>На экран «Домой»</strong>. Не видно — нажмите <strong>Ещё</strong> в конце списка.</li>
        <li>Нажмите <strong>Добавить</strong> вверху справа — на экране появится значок Tish. Открывайте его, как приложение.</li>
      </ol>
    </>
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
  return (
    <section className="settings-group" aria-label="Установить приложение">
      <h2>Установить приложение</h2>
      <div className="card-block pwa-install"><InstallBody /></div>
    </section>
  )
}

/** Что сделать для установки здесь и сейчас — кнопка, шаги для iPhone или подсказка из Telegram. */
export function InstallBody() {
  const { prompt, installed } = usePwa()
  const [copied, setCopied] = useState(false)
  const app = telegram()
  let body
  if (app) {
    const copy = () => {
      navigator.clipboard?.writeText(loginUrl()).then(() => setCopied(true), () => setCopied(false))
    }
    const ios = isIos() || app.platform === 'ios'
    body = (
      <>
        <p>Из Telegram приложение не установить — только из браузера телефона ({ios ? 'Safari' : 'Chrome'}).</p>
        <ol className="pwa-steps">
          <li>Нажмите <strong>Скопировать ссылку</strong>.</li>
          <li>Откройте <strong>{ios ? 'Safari' : 'Chrome'}</strong>, нажмите на адресную строку и вставьте ссылку.</li>
          <li>Войдите через Telegram и установите: «Настройки» → «Установить приложение» — там будет подсказка.</li>
        </ol>
        <p className="pwa-link"><input readOnly aria-label="Ссылка для браузера" value={loginUrl()} onFocus={(e) => e.currentTarget.select()} /></p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={copy}>{copied ? 'Ссылка скопирована ✓' : 'Скопировать ссылку'}</button>
          {app.openLink && !ios && (
            <button type="button" className="btn" onClick={() => app.openLink!(loginUrl(), { try_browser: 'chrome' })}>Открыть в браузере</button>
          )}
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
    body = <IosSteps />
  } else {
    body = (
      <ul className="pwa-steps">
        <li>Android: меню <strong>⋮</strong> в Chrome → <strong>Установить приложение</strong> (или «Добавить на главный экран»).</li>
        <li>Компьютер: значок установки справа в адресной строке Chrome или Edge, или меню <strong>⋮</strong> → «Установить Tish CRM».</li>
      </ul>
    )
  }
  return body
}
