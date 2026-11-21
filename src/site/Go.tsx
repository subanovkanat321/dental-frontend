import { useEffect, useState } from 'react'

import { OFFER, TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { DEMO_PATH } from '../lib/demo'
import { ContactLinks } from '../lib/ContactLinks'
import { getJson, useDemoEnabled, type Links, type PublicMaterials } from './web'

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
 * Одна ссылка для профиля Instagram (/go), как Taplink. Покупатель — владелец клиники или частный врач (аудит
 * Instagram 2026-11-20): сначала клиникам — подключиться (сразу к форме /start), «Тур по Tish» (/tour), ролик «Как это работает», спросить
 * в WhatsApp или Telegram, войти; пациентам — мелкой ссылкой внизу (выбрать клинику и записаться). Оффер — одна фраза
 * {@link OFFER} везде. Контакты — из «Сведений о платформе»: WhatsApp и Telegram — только если заданы.
 */
export function Go() {
  const [c, setC] = useState<Links>({})
  const [m, setM] = useState<PublicMaterials>({})
  useEffect(() => {
    void getJson<Links>('/web/links').then(({ data }) => setC(data ?? {}))
    void getJson<PublicMaterials>('/web/materials/public').then(({ data }) => setM(data ?? {}))
  }, [])
  const wa = c.supportWhatsapp ? `https://wa.me/${c.supportWhatsapp}` : null
  const demo = useDemoEnabled()
  return (
    <main className="site-page">
      <header className="site-hero">
        {/* Тишка — как логотип: на главную приложения (расписание; без входа — вход) */}
        <a className="site-hero-home" href="/" aria-label="Открыть Tish — расписание" title="Открыть расписание"><img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={84} height={80} /></a>
        <div><h1>Tish — программа для стоматологий Кыргызстана</h1><p>Telegram-запись, ИИ-медкарта голосом, касса — в одном приложении</p></div>
      </header>

      <section className="site-section" aria-labelledby="go-clinics">
        <h2 id="go-clinics">Для клиник и частных врачей</h2>
        {/* Оффер — сама кнопка: нажали — сразу регистрация клиники (/start, без заявки) */}
        <GoLink icon="🎁" title={`Подключить клинику — ${OFFER.toLowerCase()}`} sub="Без предоплаты — клиника готова за 5 минут" href="/start" main />
        {/* Тур — 10 шагов со скриншотами (/tour): главное «как это выглядит» для владельца клиники */}
        <GoLink icon="▶" title="Тур по Tish — 2 минуты" sub="10 шагов со скриншотами: запись, медкарта, касса" href="/tour" />
        {/* Демо-клиника без регистрации — только если включена на сервере (GET /web/demo) */}
        {demo && <GoLink icon="👀" title="Посмотреть демо" sub="Вымышленная клиника изнутри — без регистрации, за секунды" href={DEMO_PATH} />}
        {/* Ролик на минуту — на /join (плеер там же, без предзагрузки); ролика нет — коротко о главном на /about */}
        <GoLink icon={m.video ? '🎬' : '📄'} title="Как это работает" sub={m.video ? 'Ролик на минуту' : 'Запись, ИИ-диктовка, карта зубов, касса — с картинками'}
          href={m.video ? '/join#materials' : '/about'} />
        <GoLink icon="💬" title="Спросить в WhatsApp" sub="Ответим на вопросы и поможем подключиться" href={wa} />
        <GoLink icon="✈️" title="Спросить в Telegram" sub={wa ? null : 'Ответим на вопросы и поможем подключиться'} href={c.supportUrl} />
        <GoLink icon="🔐" title="Вход для клиники" href="/login" />
        <p className="hint go-note">Работать можно в Telegram и на сайте — с телефона и компьютера.</p>
      </section>

      {/* Instagram есть всегда — «Связаться» не пропадает, даже если номера поддержки не заполнены */}
      <section className="site-section" aria-labelledby="go-contacts">
        <h2 id="go-contacts">{c.supportPhones?.length ? 'Позвонить' : 'Мы в Instagram'}</h2>
        <div className="site-actions">
          <ContactLinks className={null} phones={c.supportPhones} whatsapp={null} />
          <a className="btn" href={TISH_INSTAGRAM} target="_blank" rel="noopener noreferrer">Instagram {TISH_INSTAGRAM_NAME}</a>
        </div>
      </section>

      {/* Пациентская запись — не первой: Instagram Tish для клиник, но по старой ссылке пациент должен найти врача */}
      <p className="go-patients"><a href="/clinics">Пациентам: записаться к врачу →</a></p>
      <footer className="site-footer">© {new Date().getFullYear()} Tish</footer>
    </main>
  )
}
