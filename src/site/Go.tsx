import { useEffect, useState } from 'react'

import { ContactLinks } from '../lib/ContactLinks'
import { getJson, type Links, type Tariffs } from './web'

/** Строка-ссылка /go: значок, заголовок, подпись. main — главное действие раздела (залито цветом). */
function GoLink({ icon, title, sub, href, main, badge }: {
  icon: string; title: string; sub?: string | null; href?: string | null; main?: boolean; badge?: string | null
}) {
  if (!href) return null
  const external = /^https?:/.test(href)
  return (
    <a className={main ? 'go-link main' : 'go-link'} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
      <span className="ico" aria-hidden="true">{icon}</span>
      <span className="go-text">
        {badge && <span className="go-badge">{badge}</span>}
        <strong>{title}</strong>{sub && <span>{sub}</span>}
      </span>
      <span className="go-arrow" aria-hidden="true">›</span>
    </a>
  )
}

/**
 * Одна ссылка для профиля Instagram (/go), как Taplink: пациентам — одно действие (выбрать клинику и
 * записаться), клиникам — подключиться (акция ведёт сразу к форме) и войти, всем — написать нам.
 * Контакты — из «Сведений о платформе»: WhatsApp только если он задан.
 */
export function Go() {
  const [c, setC] = useState<Links>({})
  const [t, setT] = useState<Tariffs | null>(null)
  useEffect(() => {
    void getJson<Links>('/web/links').then(({ data }) => setC(data ?? {}))
    void getJson<Tariffs>('/web/tariffs').then(({ data }) => setT(data))
  }, [])
  const contacts = Boolean(c.supportUrl || c.supportWhatsapp || c.supportPhones?.length)
  return (
    <main className="site-page">
      <header className="site-hero">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={84} height={80} />
        <div><h1>Tish</h1><p>Запись к стоматологу в Telegram — без звонков и очередей</p></div>
      </header>

      <section className="site-section" aria-labelledby="go-patients">
        <h2 id="go-patients">Пациентам</h2>
        <GoLink icon="🦷" title="Записаться к стоматологу" sub="Выберите клинику — запись в Telegram за минуту" href="/clinics" main />
      </section>

      <section className="site-section" aria-labelledby="go-clinics">
        <h2 id="go-clinics">Клиникам</h2>
        {/* Акция — сама кнопка: нажали — сразу форма заявки */}
        <GoLink icon="🎁" badge={t?.promo?.title} title="Подключить клинику бесплатно" sub="Без предоплаты — настроим за час" href="/join#form" main />
        <GoLink icon="📋" title="Что умеет приложение" sub="Запись, напоминания, касса, склад, медкарта" href="/join" />
        <GoLink icon="🔐" title="Вход для клиники" href="/login" />
        <p className="hint go-note">Работать можно в Telegram и на сайте — с телефона и компьютера.</p>
      </section>

      {contacts && (
        <section className="site-section" aria-labelledby="go-contacts">
          <h2 id="go-contacts">Связаться</h2>
          <div className="site-actions">
            {c.supportUrl && <a className="btn" data-tone="tg" href={c.supportUrl} target="_blank" rel="noopener noreferrer">Написать в Telegram</a>}
            <ContactLinks className={null} phones={c.supportPhones} whatsapp={c.supportWhatsapp} />
          </div>
        </section>
      )}
      <footer className="site-footer">© {new Date().getFullYear()} Tish</footer>
    </main>
  )
}
