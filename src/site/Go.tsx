import { useEffect, useState } from 'react'

import { getJson, type Links, type Tariffs } from './web'

function GoLink({ icon, title, sub, href }: { icon: string; title: string; sub?: string | null; href?: string | null }) {
  if (!href) return null
  const external = /^https?:/.test(href)
  return (
    <a className="go-link" href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
      <span className="ico" aria-hidden="true">{icon}</span>
      <span><strong>{title}</strong>{sub && <span>{sub}</span>}</span>
    </a>
  )
}

/**
 * Одна ссылка для профиля Instagram (/go), как Taplink: пациентам — записаться, клиникам —
 * подключиться и войти, всем — написать нам. Контакты — из «Сведений о платформе».
 */
export function Go() {
  const [c, setC] = useState<Links>({})
  const [t, setT] = useState<Tariffs | null>(null)
  useEffect(() => {
    void getJson<Links>('/web/links').then(({ data }) => setC(data ?? {}))
    void getJson<Tariffs>('/web/tariffs').then(({ data }) => setT(data))
  }, [])
  const wa = c.supportPhone ? `https://wa.me/${c.supportPhone}` : null
  return (
    <main className="site-page">
      <header className="site-hero">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={52} height={52} />
        <div><h1>Tish</h1><p>Запись к стоматологу в Telegram — без звонков и очередей</p></div>
      </header>
      <h2>Пациентам</h2>
      <GoLink icon="🦷" title="Записаться к стоматологу" sub="Выберите клинику и врача" href="/clinics" />
      <GoLink icon="✈️" title="Бот Tish в Telegram" sub="Запись, напоминания, перенос" href={c.botUrl} />
      <h2>Клиникам</h2>
      {t?.promo && <p className="tone-ok">🎁 {t.promo.title}</p>}
      <GoLink icon="🚀" title="Подключить бесплатно" sub="Без предоплаты — настроим за час" href="/join#form" />
      <GoLink icon="💰" title="Что умеет и тарифы" sub="Запись, касса, склад, медкарта" href="/join" />
      <GoLink icon="🔐" title="Вход для клиники" sub="CRM в браузере — все врачи на большом экране" href="/login" />
      {(c.supportUrl || wa) && <h2>Связаться</h2>}
      <GoLink icon="💬" title="Написать в Telegram" sub={c.supportTelegram ? `@${c.supportTelegram}` : null} href={c.supportUrl} />
      <GoLink icon="🟢" title="Написать в WhatsApp" href={wa} />
      <GoLink icon="📞" title="Позвонить" href={c.supportPhone ? `tel:+${c.supportPhone}` : null} />
      <footer className="site-footer">© {new Date().getFullYear()} Tish</footer>
    </main>
  )
}
