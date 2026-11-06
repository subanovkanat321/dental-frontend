import { useEffect, useState } from 'react'

import { ROLES, chaptersFor, imageSize, type GuideImage, type GuideRole } from './guide/content'
import { SiteHeader } from './SiteHeader'
import './guide/guide.css'

/**
 * Открыли из CRM (from=app): вернуться — в приложение, а не на страницу сайта; открылось новой
 * вкладкой — её можно закрыть. В Telegram это его встроенный браузер: «✕ Закрыть» тоже работает.
 */
function AppReturn() {
  const close = () => {
    window.close()
    // Вкладку открыли не скриптом — браузер не закроет её: тогда просто в приложение
    setTimeout(() => { window.location.href = '/' }, 150)
  }
  return (
    <nav className="site-top" aria-label="Навигация">
      <a className="site-back" href="/"><span aria-hidden="true">‹</span> Вернуться в Tish</a>
      <button type="button" className="site-close" aria-label="Закрыть руководство" onClick={close}>✕ Закрыть</button>
    </nav>
  )
}

/** Роль из адреса: /guide?role=doctor; нет или «all» — все главы. */
function roleFromUrl(): GuideRole | null {
  const value = new URLSearchParams(window.location.search).get('role')
  return ROLES.some(([key]) => key === value) ? (value as GuideRole) : null
}

/** Печатная версия: /guide?print=1 (и ?role=…) — для PDF-инструкции клиникам. */
function printFromUrl(): boolean {
  return new URLSearchParams(window.location.search).get('print') === '1'
}

/** Ссылка на печатную версию той же роли. */
function printUrl(role: GuideRole | null): string {
  return `/guide?print=1${role ? `&role=${role}` : ''}`
}

/**
 * «Руководство Tish» (/guide): подробная инструкция по CRM для сотрудников клиники — по главам и
 * ролям, со скриншотами с пометками. Текст — обычным текстом (поиск по странице и печать), сами
 * главы — данными в guide/content.ts: компонент только рисует. Роль — в адресе (?role=…), чтобы
 * ссылку из CRM («Настройки → Руководство») можно было открыть сразу для своей роли.
 */
export function Guide() {
  const [role, setRole] = useState<GuideRole | null>(roleFromUrl)
  useEffect(() => {
    document.title = 'Руководство Tish — как работать в CRM'
    // Пришли по ссылке на главу (#kassa) — к ней, когда страница нарисовалась
    const id = window.location.hash.slice(1)
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 0)
  }, [])
  const choose = (next: GuideRole | null) => {
    setRole(next)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('role', next)
    else url.searchParams.delete('role')
    url.hash = ''
    window.history.replaceState(null, '', url)
  }
  const fromApp = new URLSearchParams(window.location.search).get('from') === 'app'
  const chapters = chaptersFor(role)
  const roleTitle = ROLES.find(([key]) => key === role)?.[1]
  if (printFromUrl()) return <GuidePrint role={role} roleTitle={roleTitle} />

  return (
    <main className="site-page manual">
      {fromApp ? <AppReturn /> : <SiteHeader />}
      <header className="site-hero manual-hero">
        {/* Тишка — как логотип: на главную приложения (расписание; без входа — вход) */}
        <a className="site-hero-home" href="/" aria-label="Открыть Tish — расписание" title="Открыть расписание"><img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={84} height={80} /></a>
        <div>
          <h1>Руководство Tish</h1>
          <p>Как работать в Tish: расписание, пациенты, касса, склад и настройки — по шагам, с картинками.
            Номера на картинках совпадают с номерами шагов в тексте.</p>
        </div>
      </header>

      <div className="manual-roles" role="group" aria-label="Для кого">
        <button type="button" aria-pressed={role == null} onClick={() => choose(null)}>Все главы</button>
        {ROLES.map(([key, title]) => (
          <button key={key} type="button" aria-pressed={role === key} onClick={() => choose(key)}>{title}</button>
        ))}
      </div>
      {roleTitle && <p className="hint manual-role-note">Показаны главы для роли «{roleTitle}». Остальное — в «Все главы».</p>}
      <p className="manual-print-link"><a href={printUrl(role)}>🖨 Версия для печати и PDF{roleTitle ? ` — ${roleTitle.toLowerCase()}` : ''}</a></p>

      <div className="manual-layout">
        <nav className="manual-toc" aria-label="Оглавление">
          <h2>Оглавление</h2>
          <ol>
            {chapters.map((c) => <li key={c.id}><a href={`#${c.id}`}>{c.title}</a></li>)}
          </ol>
        </nav>

        <div className="manual-chapters">
          {chapters.map((c, i) => (
            <section key={c.id} id={c.id} className="manual-chapter" aria-labelledby={`${c.id}-title`}>
              <h2 id={`${c.id}-title`}><span className="manual-num">{i + 1}.</span> {c.title}</h2>
              <p className="manual-intro">{c.intro}</p>
              {c.sections.map((s) => (
                <article key={s.title} id={s.id} className="manual-section" aria-label={s.title}>
                  <h3>{s.title}</h3>
                  {s.text && <p>{s.text}</p>}
                  {s.steps.length > 0 && <ol className="manual-steps">{s.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
                  {s.image && <Figure image={s.image} />}
                  {s.tip && <p className="manual-tip"><strong>Совет.</strong> {s.tip}</p>}
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>

      <footer className="site-footer manual-footer">
        Не нашли ответа? В CRM: «Настройки» → «Помощь» — помощник ответит сразу, или «Техподдержка» — команда Tish.
        <br /><a href="/login">Вход для клиники</a> · © {new Date().getFullYear()} Tish
      </footer>
    </main>
  )
}

/**
 * Картинка с подписью. Не шире своего размера: маленький снимок кнопки не растягивается на всю
 * колонку; снимок телефона (×2) — в половину своих пикселей, как на экране телефона.
 */
function Figure({ image, eager = false }: { image: GuideImage; eager?: boolean }) {
  const size = imageSize(image.src)
  const maxWidth = size.width ? size.width / (image.phone ? 2 : 1) : undefined
  const url = `${import.meta.env.BASE_URL}guide/${image.src}`
  return (
    <figure className={image.phone ? 'manual-figure phone' : 'manual-figure'} style={{ maxWidth }}>
      {/* Нажать — картинка целиком в новой вкладке: на телефоне снимок компьютера мелкий */}
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={image.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" {...size} />
      </a>
      <figcaption>{image.caption}</figcaption>
    </figure>
  )
}

/**
 * Печатная инструкция для клиники (/guide?print=1&role=…): обложка (для кого, дата), оглавление,
 * главы с новой страницы, картинки грузятся сразу (ленивые не попали бы в PDF). Кнопка «Печать» — только
 * на экране. Из неё же делается PDF в «Платформа → Материалы» (docs/marketing/guide бэкенда).
 * Картинки — со вымышленной клиники (e2e/promo/guide бэкенда), настоящих пациентов на них нет.
 */
function GuidePrint({ role, roleTitle }: { role: GuideRole | null; roleTitle?: string }) {
  const chapters = chaptersFor(role)
  const today = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bishkek' }).format(new Date())
  return (
    <main className="site-page manual print">
      <nav className="manual-print-bar" aria-label="Печать">
        <a href={`/guide${role ? `?role=${role}` : ''}`}>‹ Обычная версия</a>
        <button type="button" className="btn primary" onClick={() => window.print()}>Печать или PDF</button>
      </nav>
      <header className="manual-cover">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={84} height={80} />
        <h1>Инструкция Tish для клиники</h1>
        <p className="manual-cover-role">{roleTitle ? `Для роли: ${roleTitle}` : 'Для всех сотрудников: администратор, регистратура, врач, ассистент'}</p>
        <p className="hint">Версия от {today}. Свежая версия с поиском — tish.kg/guide. Вопросы — «Настройки → Техподдержка» в Tish.</p>
      </header>
      <nav className="manual-toc" aria-label="Оглавление">
        <h2>Оглавление</h2>
        <ol>{chapters.map((c) => <li key={c.id}>{c.title}</li>)}</ol>
      </nav>
      <div className="manual-chapters">
        {chapters.map((c, i) => (
          <section key={c.id} id={c.id} className="manual-chapter" aria-labelledby={`${c.id}-title`}>
            <h2 id={`${c.id}-title`}><span className="manual-num">{i + 1}.</span> {c.title}</h2>
            <p className="manual-intro">{c.intro}</p>
            {c.sections.map((s) => (
              <article key={s.title} className="manual-section" aria-label={s.title}>
                <h3>{s.title}</h3>
                {s.text && <p>{s.text}</p>}
                {s.steps.length > 0 && <ol className="manual-steps">{s.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
                {s.image && <Figure image={s.image} eager />}
                {s.tip && <p className="manual-tip"><strong>Совет.</strong> {s.tip}</p>}
              </article>
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
