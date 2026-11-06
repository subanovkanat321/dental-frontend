import { useEffect, useState, type ReactNode } from 'react'

import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import './about.css'

/*
 * Сайт-визитка для клиник (/about): одна длинная страница, как рекламный ролик v4 (текст —
 * e2e/promo/v4/VOICE.md бэкенда). С ней идём в клиники и даём ссылку в Instagram. Каждая часть —
 * «слайд» на весь экран компьютера; на телефоне — своей высоты. Картинки — кадры записи ролика на
 * вымышленной клинике «Демо» (public/about). Контакты владелец дал для публикации.
 */

const IMG = `${import.meta.env.BASE_URL}about/`
const JOIN = '/join#form'
const ABOUT_CONTACTS = {
  instagram: TISH_INSTAGRAM,
  telegram: 'https://t.me/veratti_16',
  whatsapp: `https://wa.me/996773565895?text=${encodeURIComponent('Здравствуйте! Хочу узнать про Tish для клиники')}`,
  phone: 'tel:+996558162998',
}

type Shot = { src: string; alt: string; w?: number; h?: number }
type Visual =
  | { kind: 'duo'; desktop: Shot; phone: Shot }
  | { kind: 'phones'; phones: Shot[] }
  | { kind: 'stack'; main: Shot; second: Shot }

type Part = { id: string; nav: string; eyebrow: string; title: ReactNode; text: ReactNode; points?: string[]; visual: Visual }

const desk = (name: string, alt: string, h = 1000): Shot => ({ src: `${IMG}${name}.webp`, alt, w: 1600, h })
const phone = (name: string, alt: string): Shot => ({ src: `${IMG}${name}.webp`, alt, w: 600, h: 1298 })

const PARTS: Part[] = [
  {
    id: 'booking', nav: 'Запись', eyebrow: 'Запись и напоминания',
    title: <>Пациент записывается сам</>,
    text: <>В Telegram или на сайте — ночью, в выходные, когда удобно ему. Видит только свободное время: двойной записи не будет.
      Мама записывает ребёнка со своего Telegram.</>,
    points: [
      'Накануне бот сам напоминает о приёме',
      'Пациент нажимает «Приду» — и вы это видите',
      'Нет Telegram — напоминание уходит в WhatsApp одной кнопкой',
    ],
    visual: { kind: 'phones', phones: [
      phone('phone-site', 'Запись на сайте клиники: свободное время и данные пациента'),
      phone('phone-child', 'Мама записала ребёнка из своего Telegram'),
      phone('phone-chat', 'Напоминание накануне с кнопками «Приду» и «Нужно перенести»'),
    ] },
  },
  {
    id: 'reception', nav: 'Регистратура', eyebrow: 'Регистратура и врачи',
    title: <>Вся клиника — на одном экране</>,
    text: <>Регистратура видит день каждого врача, новые заявки, кто подтвердил, кто ещё молчит, кто не пришёл и кто ждёт оплаты.
      Отменили запись — видно, кто и когда.</>,
    points: [
      'Врач — в телефоне: свой день, свои пациенты, всё под рукой',
      'Регистратура и врачи видят одно и то же — без звонков и переписок',
    ],
    visual: { kind: 'duo',
      desktop: desk('reception', 'Расписание регистратуры: день трёх врачей, «Требует внимания», отменённые записи'),
      phone: phone('phone-schedule', 'День врача в телефоне') },
  },
  {
    id: 'dictation', nav: 'ИИ-диктовка', eyebrow: 'На приёме',
    title: <>Врач не печатает. <span className="about-hl">Он говорит</span></>,
    text: <>«Тридцать шестой, МО — поставили пломбу. Сорок седьмой — начали лечить каналы». Искусственный интеллект сам разложит
      это по зубной формуле, плану лечения и заметке. Врач проверит — и сохранит.</>,
    points: ['Пара секунд — и запись о приёме готова'],
    visual: { kind: 'duo',
      desktop: desk('dictation', 'ИИ разобрал диктовку: зубы 36 и 47, план лечения и заметка — проверить и сохранить'),
      phone: phone('phone-dictation', 'Диктовка приёма в телефоне врача') },
  },
  {
    id: 'teeth', nav: 'Карта зубов', eyebrow: 'Карта зубов',
    title: <>Не цифры, а настоящие зубы</>,
    text: <>С корнями и каналами. Кариес, пломба, коронка, имплант — видно сразу. Даже на какой стороне зуба: МО, ДО, окклюзионная.</>,
    points: ['Отметить сразу несколько зубов', 'Тот же план лечения — на компьютере и в телефоне'],
    visual: { kind: 'duo',
      desktop: desk('chart', 'Карта зубов во весь экран: корни, каналы, пломбы, коронка, имплант', 900),
      phone: phone('phone-teeth', 'Зуб 47 в телефоне: состояние и стороны зуба') },
  },
  {
    id: 'atlas', nav: '3D-атлас', eyebrow: 'Показать пациенту',
    title: <>Зуб в разрезе. В 3D</>,
    text: <>Чтобы пациент понял, зачем лечить, врач выводит на большой экран, как растёт кариес, как лечат каналы, как ставят имплант.
      По каждой услуге — короткая презентация простыми словами, на русском и кыргызском.</>,
    points: ['Пациент видит своими глазами — и решение принимает спокойно'],
    visual: { kind: 'stack',
      main: desk('atlas', '3D-атлас: зуб в разрезе, кариес дошёл до дентина', 900),
      second: desk('lesson', 'Презентация для пациента «Кариес» простыми словами', 1112) },
  },
  {
    id: 'return', nav: 'Повторный визит', eyebrow: 'Пациент пришёл снова',
    title: <>Вся история — ещё до осмотра</>,
    text: <>Врач сразу видит, когда пациент был в последний раз, что делали и что осталось по плану. А аллергии из анкеты — ещё до того,
      как взять инструмент в руки.</>,
    points: [
      'После приёма — понятное сообщение: что сделали и что дальше. На языке пациента',
      'И памятка: что можно, чего нельзя и когда нужно позвонить',
    ],
    visual: { kind: 'stack',
      main: desk('history', 'Карточка приёма: аллергия, прошлый визит и что осталось по плану'),
      second: desk('report', 'Сообщение после приёма на кыргызском и памятка «После лечения каналов»') },
  },
  {
    id: 'recall', nav: 'Позвать снова', eyebrow: 'Позвать снова',
    title: <>Незаконченный план — <span className="about-hl">деньги, которые уже ваши</span></>,
    text: <>Но лежат не в кассе. Tish сам находит тех, кого стоит позвать снова: лечение не закончено, не пришли, пора на осмотр.
      Одно нажатие — и пациент получает приглашение. А вы видите, сколько из них вернулись.</>,
    points: [
      'Фото «до» и «после» — и готовый пост для Instagram за минуту',
      'Оценки пациентов покажут, кого из врачей любят больше всего',
    ],
    visual: { kind: 'stack',
      main: desk('comeback', '«Позвать снова»: незаконченные планы лечения на сумму и кнопка «Пригласить»'),
      second: desk('before-after', 'Фото «до» и «после» — пост для Instagram') },
  },
  {
    id: 'money', nav: 'Деньги', eyebrow: 'Деньги',
    title: <>Не «примерно». <span className="about-hl">В цифрах</span></>,
    text: <>Оплата прямо в карточке приёма: наличные, карта, перевод, рассрочка. Касса за день и за месяц, долги — одним списком.</>,
    points: [
      'Материалы списываются с приёма, склад сам предупредит, что заканчивается',
      'Зарплата врачей считается сама — процент, оклад или аренда кресла',
      'Сколько приносит каждый врач и вся клиника за месяц — после материалов, техника, аренды и всех расходов',
    ],
    visual: { kind: 'stack',
      main: desk('money', 'Касса: прибыль клиники и по каждому врачу после всех расходов'),
      second: desk('analytics', 'Аналитика: способы оплаты и чем закончились приёмы') },
  },
  {
    id: 'order', nav: 'Порядок', eyebrow: 'Порядок в клинике',
    title: <>У каждого — свои права</>,
    text: <>Регистратура не видит медкарты, ассистент — денег. Важные действия — в журнале: кто отменил или перенёс запись, кто принял
      оплату, кто поменял цену. Ни одна запись не пропадёт молча.</>,
    points: [
      'Вопрос, как что сделать? Помощник прямо в приложении ответит за секунды',
      'Данные клиники видит только клиника',
    ],
    visual: { kind: 'stack',
      main: desk('journal', 'Журнал действий: кто подтвердил, перенёс или отменил запись'),
      second: desk('helper', 'Помощник в приложении отвечает, как принять доплату') },
  },
]

/** Номера-«слайды» для точек справа: герой, идея, части, ролик, контакты. */
const NAV: [string, string][] = [['start', 'Tish'], ['idea', 'Главное'], ...PARTS.map((p): [string, string] => [p.id, p.nav]),
  ['scale', 'Для кого'], ['video', 'Ролик'], ['contacts', 'Контакты']]

function Img({ shot, eager, className }: { shot: Shot; eager?: boolean; className?: string }) {
  return <img className={className} src={shot.src} alt={shot.alt} width={shot.w} height={shot.h}
    loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchPriority: 'high' as const } : {})} />
}

function Desktop({ shot, eager }: { shot: Shot; eager?: boolean }) {
  return <div className="mock-desktop"><Img shot={shot} eager={eager} /></div>
}
function Phone({ shot, eager }: { shot: Shot; eager?: boolean }) {
  return <div className="mock-phone"><Img shot={shot} eager={eager} /></div>
}

function VisualView({ v }: { v: Visual }) {
  switch (v.kind) {
    case 'duo': return <div className="vis vis-duo"><Desktop shot={v.desktop} /><Phone shot={v.phone} /></div>
    case 'phones': return <div className="vis vis-phones">{v.phones.map((p) => <Phone key={p.src} shot={p} />)}</div>
    case 'stack': return <div className="vis vis-stack"><Desktop shot={v.main} /><Desktop shot={v.second} /></div>
  }
}

/** Появление при прокрутке и текущий «слайд» для точек; без IntersectionObserver (тесты, старый браузер) всё видно сразу. */
function useScrollState() {
  const [active, setActive] = useState('start')
  const [pastHero, setPastHero] = useState(false)
  const [atContacts, setAtContacts] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const root = document.documentElement
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduce) root.classList.add('about-anim')
    const reveal = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); reveal.unobserve(e.target) }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 })
    document.querySelectorAll('[data-reveal]').forEach((el) => reveal.observe(el))
    // Текущий слайд — тот, что пересекает середину окна
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        setActive(e.target.id)
        setPastHero(e.target.id !== 'start')
        setAtContacts(e.target.id === 'contacts')
      }
    }, { rootMargin: '-50% 0px -50% 0px' })
    document.querySelectorAll('.about-slide[id]').forEach((el) => spy.observe(el))
    return () => { reveal.disconnect(); spy.disconnect(); root.classList.remove('about-anim') }
  }, [])
  return { active, pastHero, atContacts }
}

/**
 * Сайт-визитка Tish для клиник: всё главное из ролика — сверху вниз, «Попробуйте бесплатно» (форма
 * заявки /join#form) и контакты. Без запросов к API: страница статичная и открывается мгновенно.
 */
export function About() {
  const { active, pastHero, atContacts } = useScrollState()
  const year = new Date().getFullYear()
  return (
    <div className="about">
      <header className="about-top">
        <a className="about-brand" href="#start" aria-label="Tish — в начало">
          <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={20} height={30} /> Tish</a>
        <nav className="about-top-links" aria-label="Разделы">
          <a href="#contacts">Контакты</a>
          <a href="/login">Вход для клиники</a>
          <a className="about-btn primary small" href={JOIN}>Попробовать бесплатно</a>
        </nav>
      </header>

      <main>
        <section id="start" className="about-slide about-hero" aria-labelledby="about-title">
          <div className="about-inner hero-grid">
            <div className="hero-copy" data-reveal>
              <p className="about-eyebrow">CRM для стоматологий Кыргызстана</p>
              <h1 id="about-title">Tish — вся клиника <span className="about-hl">в одном приложении</span></h1>
              <p className="about-lead">На компьютере у регистратуры и в телефоне у врача. На русском и кыргызском.</p>
              <div className="about-ctas">
                <a className="about-btn primary" href={JOIN}>Попробовать бесплатно</a>
                <a className="about-btn" href={ABOUT_CONTACTS.whatsapp} target="_blank" rel="noopener noreferrer">
                  <span aria-hidden="true">💬</span> Написать в WhatsApp</a>
              </div>
              <p className="about-note">Без предоплаты — настроим за час</p>
            </div>
            <div className="vis vis-duo hero-vis" data-reveal>
              <Desktop shot={desk('day', 'Расписание клиники на компьютере: день всех врачей, следующий пациент и «Требует внимания»')} eager />
              <Phone shot={phone('phone-day', 'Свой день врача в телефоне')} eager />
            </div>
          </div>
          <a className="about-scroll" href="#idea" aria-label="Листайте вниз"><span aria-hidden="true">↓</span></a>
        </section>

        <section id="idea" className="about-slide about-statement" aria-labelledby="about-idea">
          <div className="about-inner narrow" data-reveal>
            <h2 id="about-idea">Хорошая клиника держится не только на лечении</h2>
            <ul className="about-promises">
              <li><span aria-hidden="true">🧑‍⚕️</span><span>Ни один пациент <strong>не потерялся</strong></span></li>
              <li><span aria-hidden="true">📅</span><span>Ни одна запись <strong>не забыта</strong></span></li>
              <li><span aria-hidden="true">💰</span><span>Каждый сом <strong>на своём месте</strong></span></li>
            </ul>
          </div>
        </section>

        {PARTS.map((p, i) => (
          <section key={p.id} id={p.id} className={`about-slide about-part${i % 2 ? ' flip' : ''}`} aria-labelledby={`about-${p.id}`}>
            <div className="about-inner part-grid">
              <div className="part-copy" data-reveal>
                <p className="about-eyebrow"><span className="num">{String(i + 1).padStart(2, '0')}</span> {p.eyebrow}</p>
                <h2 id={`about-${p.id}`}>{p.title}</h2>
                <p className="about-lead">{p.text}</p>
                {p.points && <ul className="about-points">{p.points.map((x) => <li key={x}>{x}</li>)}</ul>}
              </div>
              <div className="part-vis" data-reveal><VisualView v={p.visual} /></div>
            </div>
          </section>
        ))}

        <section id="scale" className="about-slide about-statement" aria-labelledby="about-scale">
          <div className="about-inner narrow" data-reveal>
            <h2 id="about-scale">И частному врачу, и большой клинике</h2>
            <div className="about-cards">
              <div className="about-card"><span className="ico" aria-hidden="true">👩‍⚕️</span><strong>Частный врач</strong><span>одно кресло — запись, медкарта и касса в телефоне</span></div>
              <div className="about-card"><span className="ico" aria-hidden="true">🏥</span><strong>Большая клиника</strong><span>десятки сотрудников — у каждого свои права</span></div>
            </div>
            <p className="about-lead">Начать можно сразу. Не хватает чего-то для вашей клиники? <strong>Просто скажите — наши разработчики сделают
              это для вас.</strong> Многое из того, что вы видите здесь, появилось по просьбам врачей.</p>
          </div>
        </section>

        <section id="video" className="about-slide about-video" aria-labelledby="about-video">
          <div className="about-inner" data-reveal>
            <h2 id="about-video">Всё это — в ролике на 4 минуты</h2>
            <div className="video-frame">
              {/* preload=none: 7 МБ скачиваются, только когда нажали «смотреть»; субтитры вшиты — можно без звука */}
              <video controls preload="none" playsInline poster={`${IMG}video-poster.webp`} width={1280} height={720}>
                <source src={`${IMG}tish-promo.mp4`} type="video/mp4" />
              </video>
            </div>
            <p className="about-note">Клиника, врачи и пациенты в ролике и на картинках — вымышленные.</p>
          </div>
        </section>

        <section id="contacts" className="about-slide about-final" aria-labelledby="about-final">
          <div className="about-inner narrow" data-reveal>
            <h2 id="about-final">Меньше рутины — <span className="about-hl">больше пациентов и спокойствия</span></h2>
            <p className="about-lead">Попробуйте бесплатно: всё приложение, без ограничений и без предоплаты. Оставьте заявку — мы позвоним и
              настроим клинику вместе с вами.</p>
            <div className="about-ctas center">
              <a className="about-btn primary big" href={JOIN}>Попробовать бесплатно</a>
            </div>
            <h3 className="about-contacts-title">Контакты</h3>
            <ul className="about-contacts">
              <li><a href={ABOUT_CONTACTS.instagram} target="_blank" rel="noopener noreferrer">
                <span className="ico" aria-hidden="true">📸</span><span><small>Instagram</small>{' '}<strong>{TISH_INSTAGRAM_NAME}</strong></span></a></li>
              <li><a href={ABOUT_CONTACTS.whatsapp} target="_blank" rel="noopener noreferrer">
                <span className="ico" aria-hidden="true">💬</span><span><small>WhatsApp</small>{' '}<strong className="num">0773 565 895</strong></span></a></li>
              <li><a href={ABOUT_CONTACTS.telegram} target="_blank" rel="noopener noreferrer">
                <span className="ico" aria-hidden="true">✈️</span><span><small>Telegram</small>{' '}<strong>@veratti_16</strong></span></a></li>
              <li><a href={ABOUT_CONTACTS.phone}>
                <span className="ico" aria-hidden="true">📞</span><span><small>Телефон</small>{' '}<strong className="num">0558 162 998</strong></span></a></li>
            </ul>
            <p className="about-site">tish.kg</p>
          </div>
        </section>
      </main>

      <footer className="about-footer">
        <a href="/go">tish.kg</a> · <a href="/clinics">Записаться к стоматологу</a> · <a href="/login">Вход для клиники</a> · © {year} Tish
      </footer>

      {/* Точки справа (компьютер): где я и переход к любому слайду */}
      <nav className="about-dots" aria-label="Слайды">
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-label={label} aria-current={active === id ? 'true' : undefined}><span>{label}</span></a>
        ))}
      </nav>

      {/* Телефон: кнопки всегда под пальцем — после первого экрана и до контактов */}
      <div className={`about-sticky${pastHero && !atContacts ? ' shown' : ''}`} aria-hidden={!pastHero || atContacts}>
        <a className="about-btn" href={ABOUT_CONTACTS.whatsapp} target="_blank" rel="noopener noreferrer" tabIndex={pastHero && !atContacts ? 0 : -1}>WhatsApp</a>
        <a className="about-btn primary" href={JOIN} tabIndex={pastHero && !atContacts ? 0 : -1}>Попробовать бесплатно</a>
      </div>
    </div>
  )
}
