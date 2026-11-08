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

/** Страница «Скачать Tish» (/app): установка как приложение — с неё браузер и предлагает установку. */
function appUrl(): string {
  return `${window.location.origin}/app`
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
      <ShareAppLink />
    </section>
  )
}

/**
 * Ссылка «Скачать Tish» коллегам: один адрес — tish.kg/app, открыли на телефоне или компьютере → установили.
 * «Поделиться» (телефон) или «Скопировать» — отправить в WhatsApp/Telegram.
 */
function ShareAppLink() {
  const [done, setDone] = useState('')
  const url = appUrl()
  const share = () => {
    if (typeof navigator.share === 'function') {
      navigator.share({ title: 'Tish', text: 'Tish на телефон или компьютер — как приложение:', url }).then(() => setDone(''), () => {})
      return
    }
    navigator.clipboard?.writeText(url).then(() => setDone('Ссылка скопирована ✓'), () => setDone('Не получилось скопировать — выделите ссылку'))
  }
  return (
    <div className="card-block pwa-share">
      <p><strong>Ссылка для сотрудников</strong> — откроют на телефоне или компьютере и установят Tish в пару нажатий.</p>
      <p className="pwa-link"><input readOnly aria-label="Ссылка «Скачать Tish»" value={url} onFocus={(e) => e.currentTarget.select()} /></p>
      <div className="actions">
        <button type="button" className="btn" onClick={share}>{typeof navigator.share === 'function' ? 'Поделиться с коллегами' : 'Скопировать для коллег'}</button>
      </div>
      {done && <p className="tone-ok" role="status">{done}</p>}
    </div>
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
      navigator.clipboard?.writeText(appUrl()).then(() => setCopied(true), () => setCopied(false))
    }
    const ios = isIos() || app.platform === 'ios'
    body = (
      <>
        <p>Из Telegram приложение не установить — только из браузера телефона ({ios ? 'Safari' : 'Chrome'}).</p>
        <ol className="pwa-steps">
          <li>Нажмите <strong>Скопировать ссылку</strong>.</li>
          <li>Откройте <strong>{ios ? 'Safari' : 'Chrome'}</strong>, нажмите на адресную строку и вставьте ссылку.</li>
          <li>Откроется страница «Скачать Tish» — там кнопка или подсказка, как установить.</li>
        </ol>
        <p className="pwa-link"><input readOnly aria-label="Ссылка для браузера" value={appUrl()} onFocus={(e) => e.currentTarget.select()} /></p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={copy}>{copied ? 'Ссылка скопирована ✓' : 'Скопировать ссылку'}</button>
          {app.openLink && !ios && (
            <button type="button" className="btn" onClick={() => app.openLink!(appUrl(), { try_browser: 'chrome' })}>Открыть в браузере</button>
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
