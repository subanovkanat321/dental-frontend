import { useEffect, useState } from 'react'

import { getJson, type Links, type Tariffs } from './web'

type Tone = 'teal' | 'orange' | 'violet' | 'blue' | 'tg' | 'wa' | 'gold'

function GoLink({ icon, title, sub, href, tone, main }: {
  icon: string; title: string; sub?: string | null; href?: string | null; tone: Tone; main?: boolean
}) {
  if (!href) return null
  const external = /^https?:/.test(href)
  return (
    <a className={`go-link tone-${tone}${main ? ' main' : ''}`} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
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
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={105} height={100} />
        <div><h1>Tish</h1><p>Запись к стоматологу в Telegram — без звонков и очередей</p></div>
      </header>
      <h2>Пациентам</h2>
      <GoLink icon="🦷" title="Записаться к стоматологу" sub="Выберите клинику и врача" href="/clinics" tone="teal" main />
      <GoLink icon="✈️" title="Бот Tish в Telegram" sub="Запись, напоминания, перенос" href={c.botUrl} tone="tg" />
      <h2>Клиникам</h2>
      {t?.promo && <p className="go-promo">🎁 {t.promo.title}</p>}
      <GoLink icon="🚀" title="Подключить бесплатно" sub="Без предоплаты — настроим за час" href="/join#form" tone="orange" main />
      <GoLink icon="💰" title="Что умеет и тарифы" sub="Запись, касса, склад, медкарта" href="/join" tone="gold" />
      <GoLink icon="🔐" title="Вход для клиники" sub="CRM в браузере — все врачи на большом экране" href="/login" tone="violet" />
      {(c.supportUrl || wa) && <h2>Связаться</h2>}
      <GoLink icon="💬" title="Написать в Telegram" sub={c.supportTelegram ? `@${c.supportTelegram}` : null} href={c.supportUrl} tone="tg" />
      <GoLink icon="🟢" title="Написать в WhatsApp" href={wa} tone="wa" />
      <GoLink icon="📞" title="Позвонить" href={c.supportPhone ? `tel:+${c.supportPhone}` : null} tone="blue" />
      <footer className="site-footer">© {new Date().getFullYear()} Tish</footer>
    </main>
  )
}
