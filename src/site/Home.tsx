import { useEffect, useRef, useState, type FormEvent } from 'react'

import { cityName, useClinicFilter, withCity } from '../lib/clinicSearch'
import { TISH_INSTAGRAM, TISH_TELEGRAM, tishWhatsapp, TISH_CHANNEL } from '../lib/brand'
import { getJson, inAppBrowser, initials, tgLink, useSiteLang, type DirectoryClinic, type Links } from './web'
import './home.css'

type Lang = 'ru' | 'ky'

const TEXTS = {
  ru: {
    docTitle: 'Tish (Тиш) — онлайн-запись к стоматологу в Бишкеке',
    forClinics: 'Для клиник', login: 'Вход для клиник', loginShort: 'Вход', nav: 'Главное меню', connect: 'Подключить клинику',
    clinicAsk: 'Вы клиника?', clinicGo: 'Подключитесь бесплатно →',
    eyebrow: 'Онлайн-запись к стоматологу', title: 'Запишитесь к стоматологу без звонков',
    tagline: 'Выберите клинику и врача, посмотрите свободное время и запишитесь за минуту — на сайте или в Telegram.',
    search: 'Клиника, врач или адрес', find: 'Найти', cities: 'Город', allCities: 'Все города',
    list: 'Клиники', book: 'Записаться', telegram: 'В Telegram', more: 'Врачи, услуги и цены', map: 'На карте', doctors: 'Врачи',
    clinic: 'Стоматология', more_doctors: (n: number) => `ещё ${n}`,
    nothing: 'Ничего не нашлось — попробуйте другое слово или город.', showAll: 'Показать все клиники',
    empty: 'Клиники скоро появятся здесь.', error: 'Не удалось загрузить список — обновите страницу через минуту.', loading: 'Загрузка…',
    inApp: 'Открыли из Instagram? Если Telegram не открывается — нажмите ⋮ вверху → «Открыть в браузере» или запишитесь на сайте.',
    stepsTitle: 'Как записаться',
    steps: [
      ['Найдите клинику', 'По названию, врачу или адресу — рядом с домом или работой.'],
      ['Выберите врача и время', 'Показываем только свободные окна — без звонков и ожидания на линии.'],
      ['Подтвердите запись', 'Оставьте имя и телефон — клиника сразу увидит запись. В Telegram бот ещё и напомнит о приёме.'],
    ],
    bandTitle: 'Вы врач или руководитель клиники?',
    bandText: 'Подключите клинику к Tish и получайте пациентов через онлайн-запись. Расписание, медкарта и касса — в одном приложении.',
    free: 'Это бесплатно!', freeBadge: 'Бесплатно',
    join: 'Подключить клинику — бесплатно', signIn: 'Войти', aboutTish: 'Подробнее о Tish',
    patients: 'Пациентам', allClinics: 'Все клиники', clinics: 'Клиникам', about: 'О Tish', tour: 'Тур по Tish', guide: 'Руководство', channel: 'Канал для стоматологов',
    made: 'Сделано в Кыргызстане', contact: 'Связаться с нами', waText: 'Здравствуйте! Вопрос про Tish',
    preview: { doctor: 'Врач-стоматолог', days: ['Пн', 'Вт', 'Ср', 'Чт'], free: 'Свободно сегодня', example: 'Пример',
      label: 'Пример записи: выберите день и время', hint: 'Выберите клинику — и запишитесь к её врачу' },
  },
  ky: {
    docTitle: 'Tish — Бишкекте тиш дарыгерине онлайн жазылуу',
    forClinics: 'Клиникаларга', login: 'Клиникалар үчүн кирүү', loginShort: 'Кирүү', nav: 'Башкы меню', connect: 'Клиниканы туташтыруу',
    clinicAsk: 'Сиз клиникасызбы?', clinicGo: 'Акысыз туташыңыз →',
    eyebrow: 'Тиш дарыгерине онлайн жазылуу', title: 'Тиш дарыгерине чалбай эле жазылыңыз',
    tagline: 'Клиниканы жана дарыгерди тандап, бош убакытты көрүп, бир мүнөттө жазылыңыз — сайтта же Telegram аркылуу.',
    search: 'Клиника, дарыгер же дарек', find: 'Издөө', cities: 'Шаар', allCities: 'Бардык шаарлар',
    list: 'Клиникалар', book: 'Жазылуу', telegram: 'Telegram’да', more: 'Дарыгерлер, кызматтар жана баалар', map: 'Картада', doctors: 'Дарыгерлер',
    clinic: 'Стоматология', more_doctors: (n: number) => `дагы ${n}`,
    nothing: 'Эч нерсе табылган жок — башка сөз же шаар менен издеңиз.', showAll: 'Бардык клиникаларды көрсөтүү',
    empty: 'Клиникалар жакында ушул жерде болот.', error: 'Тизме жүктөлгөн жок — бир мүнөттөн кийин жаңыртыңыз.', loading: 'Жүктөлүүдө…',
    inApp: 'Instagram’дан ачтыңызбы? Telegram ачылбаса — жогорудагы ⋮ → «Браузерде ачуу» басыңыз же сайтта жазылыңыз.',
    stepsTitle: 'Кантип жазылуу керек',
    steps: [
      ['Клиниканы табыңыз', 'Аталышы, дарыгери же дареги боюнча — үйүңүзгө же жумушуңузга жакын.'],
      ['Дарыгерди жана убакытты тандаңыз', 'Бош убакыттар гана көрсөтүлөт — чалуусуз жана күтүүсүз.'],
      ['Жазылууну ырастаңыз', 'Атыңызды жана телефонуңузду калтырыңыз — клиника жазылууну дароо көрөт. Telegram’да бот кабыл алууну эскертет.'],
    ],
    bandTitle: 'Сиз клиниканын дарыгерисизби же жетекчисисизби?',
    bandText: 'Клиникаңызды Tish’ке туташтырып, бейтаптарды онлайн жазылуу аркылуу алыңыз. Жадыбал, медкарта жана касса — бир тиркемеде.',
    free: 'Бул акысыз!', freeBadge: 'Акысыз',
    join: 'Клиниканы туташтыруу — акысыз', signIn: 'Кирүү', aboutTish: 'Tish жөнүндө кененирээк',
    patients: 'Бейтаптарга', allClinics: 'Бардык клиникалар', clinics: 'Клиникаларга', about: 'Tish жөнүндө', tour: 'Tish боюнча тур', guide: 'Колдонмо', channel: 'Тиш дарыгерлери үчүн канал',
    made: 'Кыргызстанда жасалган', contact: 'Биз менен байланышуу', waText: 'Саламатсызбы! Tish боюнча суроо бар',
    preview: { doctor: 'Тиш дарыгери', days: ['Дш', 'Шш', 'Шр', 'Бш'], free: 'Бүгүн бош', example: 'Үлгү',
      label: 'Жазылуу үлгүсү: күндү жана убакытты тандаңыз', hint: 'Клиниканы тандаңыз — анан анын дарыгерине жазылыңыз' },
  },
}

/** Сколько врачей показать именами на карточке; остальные — «ещё N». */
const DOCTOR_TAGS = 3

/**
 * Главная tish.kg для пациентов: шапка с входом для клиник, поиск клиники
 * или врача с выбором города, карточки клиник с «Записаться» (запись на сайте /c/<код>#book или страница
 * клиники), «Как записаться» в три шага и полоса для врачей и руководителей клиник. Без входа и без Telegram.
 * Её показывает App на «/» браузеру без входа. Запись — наша прежняя (страница клиники, WebBooking, бот): сюда
 * только ссылки на неё; каталог /clinics (Directory.tsx) — как был, с той же логикой поиска (useClinicFilter).
 */
export function Home() {
  const [lang, setLang] = useSiteLang()
  const t = TEXTS[lang]
  const [clinics, setClinics] = useState<DirectoryClinic[] | null | 'error'>(null)
  useEffect(() => {
    void getJson<DirectoryClinic[]>('/web/clinics').then(({ data }) => setClinics(data ?? 'error'))
  }, [])
  // Связь — из «Сведений о платформе»; пусто или нет ответа — адреса Tish по умолчанию (lib/brand.ts)
  const [links, setLinks] = useState<Links>({})
  useEffect(() => {
    void getJson<Links>('/web/links').then(({ data }) => setLinks(data ?? {}))
  }, [])
  useEffect(() => {
    document.title = t.docTitle
  }, [t.docTitle])
  const list = Array.isArray(clinics) ? clinics : []
  const filter = useClinicFilter(list, (c) => [c.name, c.address, ...c.doctors.map((d) => d.fullName)], { searchFrom: 0 })
  const results = useRef<HTMLElement>(null)
  // «Найти» — фильтр и так живой; кнопка закрывает клавиатуру телефона и показывает список
  const find = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    results.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const reset = () => { filter.setQuery(''); filter.setCity('') }
  /** «Записаться» в примере: пример не настоящий — плавно к списку клиник с подсказкой, куда нажать. */
  const [pickHint, setPickHint] = useState(false)
  const showClinics = () => {
    setPickHint(true)
    results.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const inApp = inAppBrowser()
  return (
    <div className="home">
      <header className="home-top">
        <div className="home-wrap home-top-row">
          <a className="home-brand" href="/" aria-label="Tish — на главную">
            <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={20} height={30} />
            <span>Tish</span>
          </a>
          <nav className="home-nav" aria-label={t.nav}>
            <a className="home-nav-link" href="/about">{t.forClinics}</a>
            <HomeLang lang={lang} onChange={setLang} />
            {/* Регистрация клиники — сразу в шапке (на узком экране — строкой под поиском: в шапке не помещается) */}
            <a className="home-btn home-join" href="/join">{t.connect}</a>
            <a className="home-btn home-btn-primary home-login" href="/login">
              <span className="home-wide">{t.login}</span><span className="home-narrow">{t.loginShort}</span>
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-wrap home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-eyebrow"><span className="home-dot" aria-hidden="true" />{t.eyebrow}</p>
              <h1 id="home-title">{t.title}</h1>
              <p className="home-tagline">{t.tagline}</p>
              <form className="home-search" role="search" onSubmit={find}>
                <label className="home-search-field">
                  <SearchIcon />
                  <input type="search" placeholder={t.search} aria-label={t.search} value={filter.query} enterKeyHint="search"
                    onChange={(e) => filter.setQuery(e.target.value)} />
                </label>
                <button type="submit" className="home-btn home-btn-primary home-search-go">{t.find}</button>
              </form>
              {filter.showCities && (
                <div className="home-cities" role="group" aria-label={t.cities}>
                  <button type="button" aria-pressed={!filter.city} onClick={() => filter.setCity('')}>{t.allCities}</button>
                  {filter.cities.map(({ city, count }) => (
                    <button key={city} type="button" aria-pressed={filter.city === city} onClick={() => filter.setCity(filter.city === city ? '' : city)}>
                      {cityName(city, lang)} <span className="count">{count}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="home-clinic-cta">{t.clinicAsk} <a href="/join">{t.clinicGo}</a></p>
            </div>
            <BookingPreview t={t.preview} book={t.book} onBook={showClinics} />
          </div>
        </section>

        {inApp && <p className="home-wrap home-inapp">{t.inApp}</p>}

        <section className="home-wrap home-list" ref={results} aria-labelledby="home-list-title" aria-busy={clinics === null}>
          <h2 id="home-list-title">{t.list}{Array.isArray(clinics) && clinics.length > 0 && <span className="home-count">{filter.shown.length}</span>}</h2>
          {pickHint && <p className="home-pick-hint" role="status">👇 {t.preview.hint}</p>}
          {clinics === 'error' ? <p className="home-message">{t.error}</p> : clinics === null ? (
            <div className="home-grid" role="status" aria-label={t.loading}>
              {[0, 1, 2].map((i) => <div key={i} className="home-card home-skeleton" aria-hidden="true" />)}
            </div>
          ) : clinics.length === 0 ? <p className="home-message">{t.empty}</p> : filter.shown.length === 0 ? (
            <div className="home-message">
              <p>{t.nothing}</p>
              <button type="button" className="home-btn" onClick={reset}>{t.showAll}</button>
            </div>
          ) : (
            <div className="home-grid">
              {filter.shown.map((c) => <ClinicCard key={c.pageUrl} c={c} t={t} lang={lang} inApp={inApp} />)}
            </div>
          )}
        </section>

        <section className="home-wrap home-steps" aria-labelledby="home-steps-title">
          <h2 id="home-steps-title">{t.stepsTitle}</h2>
          <ol>
            {t.steps.map(([title, text], i) => (
              <li key={title}><span className="home-step-n" aria-hidden="true">{i + 1}</span><strong>{title}</strong><span>{text}</span></li>
            ))}
          </ol>
        </section>

        <section className="home-wrap" aria-labelledby="home-band-title">
          <div className="home-band">
            <img className="home-band-tishka" src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={120} height={114} />
            <div className="home-band-copy">
              <span className="home-free">{t.freeBadge}</span>
              <h2 id="home-band-title">{t.bandTitle}</h2>
              <p>{t.bandText} <strong>{t.free}</strong></p>
            </div>
            <div className="home-band-actions">
              <a className="home-btn home-btn-primary" href="/join">{t.join}</a>
              <a className="home-btn" href="/login">{t.signIn}</a>
              <a className="home-band-more" href="/about">{t.aboutTish} →</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-wrap home-footer-grid">
          <div className="home-footer-brand">
            <span className="home-brand"><img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={16} height={24} /><span>Tish</span></span>
            <span>{t.made} 🇰🇬</span>
          </div>
          <nav aria-label={t.patients}>
            <strong>{t.patients}</strong>
            <a href="/clinics">{t.allClinics}</a>
          </nav>
          <nav aria-label={t.clinics}>
            <strong>{t.clinics}</strong>
            <a href="/about">{t.about}</a>
            <a href="/tour">{t.tour}</a>
            <a href="/guide">{t.guide}</a>
            <a href={TISH_CHANNEL} target="_blank" rel="noopener noreferrer">{t.channel}</a>
            <a href="/join">{t.join}</a>
            <a href="/login">{t.login}</a>
          </nav>
          <section className="home-contact" aria-labelledby="home-contact-title">
            <strong id="home-contact-title">{t.contact}</strong>
            <div>
              <a className="home-social" href={tishWhatsapp(t.waText, links.supportWhatsapp || undefined)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon />WhatsApp</a>
              <a className="home-social" href={links.supportUrl || TISH_TELEGRAM} target="_blank" rel="noopener noreferrer"><TelegramIcon />Telegram</a>
              <a className="home-social" href={TISH_INSTAGRAM} target="_blank" rel="noopener noreferrer"><InstagramIcon />Instagram</a>
            </div>
          </section>
        </div>
      </footer>
    </div>
  )
}

type Texts = (typeof TEXTS)[Lang]

/** Карточка клиники: буква-аватар, название, адрес, врачи метками, «Записаться». */
function ClinicCard({ c, t, lang, inApp }: { c: DirectoryClinic; t: Texts; lang: Lang; inApp: boolean }) {
  const name = c.name || t.clinic
  const address = withCity(c.address, c.city ? cityName(c.city, lang) : c.city)
  const shown = c.doctors.slice(0, DOCTOR_TAGS)
  const rest = c.doctors.length - shown.length
  // Instagram и похожие: t.me там часто не открывает Telegram — сразу tg://
  const telegram = c.telegramUrl ? (inApp && tgLink(c.telegramUrl)) || c.telegramUrl : null
  return (
    <article className="home-card">
      <div className="home-card-head">
        <span className="home-avatar" aria-hidden="true">{initials(name).charAt(0) || 'T'}</span>
        <div className="home-card-title">
          <h3><a href={c.pageUrl}>{name}</a></h3>
          {address && (
            <p className="home-address">
              <PinIcon />{address}
              {c.mapUrl && <> · <a href={c.mapUrl} target="_blank" rel="noopener noreferrer">{t.map}</a></>}
            </p>
          )}
          <a className="home-card-more" href={c.pageUrl}>{t.more} →</a>
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="home-tags" aria-label={t.doctors}>
          {shown.map((d) => (
            <li key={d.fullName}>
              {d.photoUrl ? <img src={d.photoUrl} alt="" width={22} height={22} /> : <span className="home-tag-ini" aria-hidden="true">{initials(d.fullName)}</span>}
              {d.fullName}
            </li>
          ))}
          {rest > 0 && <li className="home-tag-more">{t.more_doctors(rest)}</li>}
        </ul>
      )}
      <div className="home-card-actions">
        <a className="home-btn home-btn-primary" href={c.bookingUrl ?? c.pageUrl}>{t.book}</a>
        {telegram && <a className="home-btn" href={telegram} target={telegram.startsWith('tg:') ? undefined : '_blank'} rel="noopener noreferrer">{t.telegram}</a>}
      </div>
    </article>
  )
}

/** Переключатель языка шапки: коротко «Рус | Кыр», чтобы влезал в телефон рядом со входом. */
function HomeLang({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="home-lang" role="group" aria-label="Тил / Язык">
      <button type="button" aria-pressed={lang === 'ru'} aria-label="Русский" onClick={() => onChange('ru')}>Рус</button>
      <button type="button" aria-pressed={lang === 'ky'} aria-label="Кыргызча" onClick={() => onChange('ky')}>Кыр</button>
    </div>
  )
}

/** Время в примере — вымышленные окна, не данные врача; у каждого дня свои. */
const PREVIEW_TIMES = [
  ['09:00', '10:30', '12:00', '14:30', '16:00', '17:30'],
  ['09:30', '11:00', '12:30', '14:00', '15:30', '17:00'],
  ['10:00', '11:30', '13:00', '15:00', '16:30', '18:00'],
  ['09:00', '09:30', '11:30', '13:30', '15:00', '16:30'],
]

/**
 * Пример записи справа в шапке (компьютер): день и время можно выбрать, как в настоящей записи, а «Записаться» — плавно
 * к списку клиник с подсказкой «Выберите клинику…»: врач тут вымышленный, поэтому в углу метка «Пример».
 */
function BookingPreview({ t, book, onBook }: { t: Texts['preview']; book: string; onBook: () => void }) {
  const [day, setDay] = useState(1)
  const [time, setTime] = useState(3)
  return (
    <div className="home-preview">
      <div className="home-preview-card" role="group" aria-label={t.label}>
        <span className="home-preview-example">{t.example}</span>
        <div className="home-preview-doc">
          <span className="home-avatar small" aria-hidden="true">Д</span>
          <span><strong>{t.doctor}</strong><span>{t.free}</span></span>
        </div>
        <div className="home-preview-days">
          {t.days.map((d, i) => (
            <button key={d} type="button" aria-pressed={day === i} className={day === i ? 'on' : undefined}
              onClick={() => { setDay(i); setTime(-1) }}><small>{d}</small>{i + 8}</button>
          ))}
        </div>
        <div className="home-preview-times">
          {(PREVIEW_TIMES[day] ?? []).map((x, i) => (
            <button key={x} type="button" aria-pressed={time === i} className={time === i ? 'on' : undefined} onClick={() => setTime(i)}>{x}</button>
          ))}
        </div>
        <button type="button" className="home-preview-btn" onClick={onBook}>{book}</button>
      </div>
      <img className="home-preview-tishka" src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={132} height={125} />
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8L4 20Z" /><path d="M9.2 8.6c.2-.5.5-.5.8-.5h.5l.9 2.1-.6.8c.5 1 1.3 1.8 2.3 2.3l.8-.6 2.1.9v.5c0 .3 0 .6-.5.8-.8.4-1.8.3-3.4-.7a9 9 0 0 1-2.4-2.4c-1-1.6-1.1-2.6-.7-3.4Z" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M21 4 3 11l6 2.5L11.5 20l3-4.2 4.5 3.2L21 4Z" /><path d="m9 13.5 7.5-5.5" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="home-search-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg className="home-pin" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  )
}
