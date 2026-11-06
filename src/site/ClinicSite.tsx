import { lazy, Suspense, useEffect, useState } from 'react'

import { ContactLinks } from '../lib/ContactLinks'
import { SiteHeader } from './SiteHeader'
import { clinicCode, getJson, inAppBrowser, initials, promoCode, tgLink, useSiteLang, withPromo, type ClinicPage } from './web'
import { Loading } from '../layout/Loading'

// Форма записи на сайте — отдельным чанком: страницу клиники открывают с телефона, а форма нужна не всем
const WebBooking = lazy(() => import('./WebBooking'))

/** Открыта форма записи на сайте: адрес /c/<код>#book — можно дать ссылкой, «Назад» в браузере её закрывает. */
function useBookHash(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(() => window.location.hash === '#book')
  useEffect(() => {
    const sync = () => setOpen(window.location.hash === '#book')
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])
  const show = () => {
    window.history.pushState({ fromPage: true }, '', '#book')
    setOpen(true)
    window.scrollTo?.({ top: 0 })
  }
  const hide = () => {
    // Открыли кнопкой на этой странице — шаг назад в истории; пришли сразу по ссылке с #book — убрать #book
    if ((window.history.state as { fromPage?: boolean } | null)?.fromPage) window.history.back()
    else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setOpen(false)
    }
  }
  return [open, show, hide]
}

const TEXTS = {
  ru: {
    title: 'Стоматология', tagline: 'Запишитесь онлайн за минуту — бот напомнит о приёме 😊', book: 'Записаться онлайн в Telegram',
    bookWeb: 'Записаться на сайте — без Telegram',
    settingUp: '🛠 Клиника ещё настраивается — запись скоро.',
    whatsapp: 'Написать в WhatsApp', call: 'Позвонить', back: 'Назад', map: 'Как добраться (2ГИС)', doctors: 'Наши врачи', services: 'Услуги и цены',
    min: 'мин', waText: 'Здравствуйте! Хочу записаться на приём 🦷', howTitle: 'Как записаться',
    how: ['Нажмите «Записаться онлайн в Telegram»', 'Выберите врача, услугу и удобное время', 'Врач подтвердит запись, бот напомнит накануне'],
    error: 'Не удалось загрузить страницу — обновите её через минуту.', loading: 'Загрузка…',
    inApp: 'Открыли из Instagram? Если Telegram не открывается — нажмите ⋮ вверху → «Открыть в браузере» или', openTg: 'открыть приложение Telegram',
    promo: 'Промокод {code} подставится при записи в боте. Скидку применяет клиника на приёме.',
  },
  ky: {
    title: 'Стоматология', tagline: 'Бир мүнөттө онлайн жазылыңыз — бот кабыл алуу тууралуу эскертет 😊', book: 'Telegram аркылуу онлайн жазылуу',
    bookWeb: 'Сайтта жазылуу — Telegram’сыз',
    settingUp: '🛠 Клиника азыр даярдалып жатат — жазылуу жакында ачылат.',
    whatsapp: 'WhatsApp’ка жазуу', call: 'Чалуу', back: 'Артка', map: 'Кантип жетүү керек (2ГИС)', doctors: 'Биздин дарыгерлер', services: 'Кызматтар жана баалар',
    min: 'мүн.', waText: 'Саламатсызбы! Кабыл алууга жазылгым келет 🦷', howTitle: 'Кантип жазылуу керек',
    how: ['«Telegram аркылуу онлайн жазылуу» баскычын басыңыз', 'Дарыгерди, кызматты жана ыңгайлуу убакытты тандаңыз', 'Дарыгер жазылууну ырастайт, бот бир күн мурун эскертет'],
    error: 'Барак жүктөлгөн жок — бир мүнөттөн кийин жаңыртыңыз.', loading: 'Жүктөлүүдө…',
    inApp: 'Instagram’дан ачтыңызбы? Telegram ачылбаса — жогорудагы ⋮ → «Браузерде ачуу» басыңыз же', openTg: 'Telegram колдонмосун ачыңыз',
    promo: '{code} промокоду боттогу жазылууда өзү коюлат. Арзандатууну клиника кабыл алууда колдонот.',
  },
}

export function LangSwitch({ lang, onChange }: { lang: 'ru' | 'ky'; onChange: (l: 'ru' | 'ky') => void }) {
  return (
    <div className="lang-switch" role="group" aria-label="Тил / Язык">
      <button type="button" aria-pressed={lang === 'ru'} onClick={() => onChange('ru')}>Русский</button>
      <button type="button" aria-pressed={lang === 'ky'} onClick={() => onChange('ky')}>Кыргызча</button>
    </div>
  )
}

/**
 * Страница клиники для пациентов (/c/<код>) — ссылка в шапке Instagram: записаться в боте,
 * WhatsApp, позвонить, врачи, услуги с ценами, адрес. Без входа: только то, что пациент видит в боте.
 */
export function ClinicSite() {
  const [lang, setLang] = useSiteLang()
  const t = TEXTS[lang]
  const [state, setState] = useState<{ data: ClinicPage | null; failed: boolean }>({ data: null, failed: false })
  const [booking, showBooking, hideBooking] = useBookHash()
  useEffect(() => {
    const code = clinicCode()
    void getJson<ClinicPage>(code ? `/web/clinic?code=${encodeURIComponent(code)}` : '/web/clinic').then(({ status, data }) => {
      // Нет такой клиники (старая или неверная ссылка) — общий каталог, а не пустая страница
      if (status === 404) window.location.replace('/clinics')
      else setState({ data, failed: !data })
    })
  }, [])
  const d = state.data
  useEffect(() => {
    if (d) document.title = d.name || TEXTS.ru.title
  }, [d])
  if (state.failed) return <main className="site-page"><SiteHeader back={t.back} /><p className="site-message">{t.error}</p></main>
  if (!d) return <main className="site-page"><SiteHeader back={t.back} /><Loading className="site-message" text={t.loading} /></main>
  const name = d.name || t.title
  // Ссылка из рекламы с ?promo=КОД — бот получит код вместе с клиникой и подставит его в форму записи
  const promo = promoCode()
  const telegramUrl = withPromo(d.telegramUrl, promo)
  const price = (som: number) => {
    const n = new Intl.NumberFormat('ru-RU').format(som)
    return lang === 'ky' ? `${n} сомдон баштап` : `от ${n} сом`
  }
  if (booking && d.bookingUrl) {
    return (
      <main className="site-page">
        <SiteHeader back={t.back}><LangSwitch lang={lang} onChange={setLang} /></SiteHeader>
        <h1>{name}</h1>
        <Suspense fallback={<Loading className="site-message" text={t.loading} />}>
          <WebBooking code={clinicCode()} lang={lang} onClose={hideBooking} />
        </Suspense>
      </main>
    )
  }
  return (
    <main className="site-page">
      <SiteHeader back={t.back}><LangSwitch lang={lang} onChange={setLang} /></SiteHeader>
      <div className="site-hero">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={84} height={80} />
        <div><h1>{name}</h1>{d.settingUp ? <p role="status">{t.settingUp}</p> : <p>{t.tagline}</p>}</div>
      </div>
      <div className="site-actions">
        {telegramUrl && <a className="btn primary" href={telegramUrl} target="_blank" rel="noopener noreferrer">📲 {t.book}</a>}
        {/* Без Telegram (у многих пожилых его нет) — форма здесь же, клиника подтверждает звонком */}
        {d.bookingUrl && <button type="button" className={telegramUrl ? 'btn' : 'btn primary'} onClick={showBooking}>🌐 {t.bookWeb}</button>}
        <ContactLinks className={null} phones={d.phones} whatsapp={d.whatsapp} waText={t.waText} texts={t} />
      </div>
      {telegramUrl && promo && <p className="hint">🎟 {t.promo.replace('{code}', promo)}</p>}
      {telegramUrl && <InAppHint url={telegramUrl} text={t.inApp} link={t.openTg} />}
      {(d.address || d.mapUrl) && (
        <p className="site-address">📍 {d.address}{d.mapUrl && <>{d.address && ' · '}<a href={d.mapUrl} target="_blank" rel="noopener noreferrer">{t.map}</a></>}</p>
      )}
      {d.telegramUrl && (
        <section className="site-card">
          <h2>{t.howTitle}</h2>
          <ol className="site-how">{t.how.map((step) => <li key={step}>{step}</li>)}</ol>
        </section>
      )}
      {d.doctors.length > 0 && (
        <section className="site-card">
          <h2>{t.doctors}</h2>
          {d.doctors.map((doc) => (
            <div key={doc.fullName} className="site-doctor">
              {doc.photoUrl ? <img src={doc.photoUrl} alt="" width={52} height={52} /> : <span className="initials" aria-hidden="true">{initials(doc.fullName)}</span>}
              <span><strong>{doc.fullName}</strong>{doc.about && <span className="hint">{doc.about}</span>}</span>
            </div>
          ))}
        </section>
      )}
      {d.services.length > 0 && (
        <section className="site-card">
          <h2>{t.services}</h2>
          <ul className="site-list site-services">
            {d.services.map((s) => (
              <li key={s.name}><span><strong>{s.name}</strong><span className="hint"> ⏱ {s.durationMinutes} {t.min}</span></span>
                {s.priceSom != null && <b className="nowrap">{price(s.priceSom)}</b>}</li>
            ))}
          </ul>
        </section>
      )}
      <footer className="site-footer">© {new Date().getFullYear()} {name}</footer>
    </main>
  )
}

/**
 * Встроенный браузер Instagram (ссылка из шапки профиля) часто не открывает t.me: подсказка
 * «⋮ → Открыть в браузере» и запасная ссылка tg://resolve с тем же start — сразу в Telegram.
 */
export function InAppHint({ url, text, link }: { url?: string; text: string; link: string }) {
  const tg = tgLink(url)
  if (!inAppBrowser()) return null
  return <p className="tone-wait site-inapp">{tg ? <>{text} <a href={tg}>{link}</a>.</> : text}</p>
}
