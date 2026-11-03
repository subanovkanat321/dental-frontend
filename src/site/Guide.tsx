import { useEffect, useState } from 'react'

import { ROLES, chaptersFor, imageSize, type GuideImage, type GuideRole } from './guide/content'
import { SiteHeader } from './SiteHeader'
import './guide/guide.css'

/** Роль из адреса: /guide?role=doctor; нет или «all» — все главы. */
function roleFromUrl(): GuideRole | null {
  const value = new URLSearchParams(window.location.search).get('role')
  return ROLES.some(([key]) => key === value) ? (value as GuideRole) : null
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
  const chapters = chaptersFor(role)
  const roleTitle = ROLES.find(([key]) => key === role)?.[1]

  return (
    <main className="site-page manual">
      <SiteHeader />
      <header className="site-hero manual-hero">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={84} height={80} />
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
                <article key={s.title} className="manual-section" aria-label={s.title}>
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
function Figure({ image }: { image: GuideImage }) {
  const size = imageSize(image.src)
  const maxWidth = size.width ? size.width / (image.phone ? 2 : 1) : undefined
  const url = `${import.meta.env.BASE_URL}guide/${image.src}`
  return (
    <figure className={image.phone ? 'manual-figure phone' : 'manual-figure'} style={{ maxWidth }}>
      {/* Нажать — картинка целиком в новой вкладке: на телефоне снимок компьютера мелкий */}
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={image.alt} loading="lazy" decoding="async" {...size} />
      </a>
      <figcaption>{image.caption}</figcaption>
    </figure>
  )
}
