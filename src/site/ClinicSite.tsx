import { useEffect, useState } from 'react'

import { formatPhone } from '../lib/time'
import { clinicCode, getJson, initials, useSiteLang, type ClinicPage } from './web'

const TEXTS = {
  ru: {
    title: 'Стоматология', tagline: 'Запишитесь онлайн за минуту — бот напомнит о приёме 😊', book: 'Записаться онлайн в Telegram',
    whatsapp: 'Написать в WhatsApp', call: 'Позвонить', map: 'Как добраться (2ГИС)', doctors: 'Наши врачи', services: 'Услуги и цены',
    min: 'мин', waText: 'Здравствуйте! Хочу записаться на приём 🦷', howTitle: 'Как записаться',
    how: ['Нажмите «Записаться онлайн в Telegram»', 'Выберите врача, услугу и удобное время', 'Врач подтвердит запись, бот напомнит накануне'],
    error: 'Не удалось загрузить страницу — обновите её через минуту.', loading: 'Загрузка…',
  },
  ky: {
    title: 'Стоматология', tagline: 'Бир мүнөттө онлайн жазылыңыз — бот кабыл алуу тууралуу эскертет 😊', book: 'Telegram аркылуу онлайн жазылуу',
    whatsapp: 'WhatsApp’ка жазуу', call: 'Чалуу', map: 'Кантип жетүү керек (2ГИС)', doctors: 'Биздин дарыгерлер', services: 'Кызматтар жана баалар',
    min: 'мүн.', waText: 'Саламатсызбы! Кабыл алууга жазылгым келет 🦷', howTitle: 'Кантип жазылуу керек',
    how: ['«Telegram аркылуу онлайн жазылуу» баскычын басыңыз', 'Дарыгерди, кызматты жана ыңгайлуу убакытты тандаңыз', 'Дарыгер жазылууну ырастайт, бот бир күн мурун эскертет'],
    error: 'Барак жүктөлгөн жок — бир мүнөттөн кийин жаңыртыңыз.', loading: 'Жүктөлүүдө…',
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
  if (state.failed) return <main className="site-page"><p className="site-message">{t.error}</p></main>
  if (!d) return <main className="site-page"><p className="site-message hint">{t.loading}</p></main>
  const name = d.name || t.title
  const price = (som: number) => {
    const n = new Intl.NumberFormat('ru-RU').format(som)
    return lang === 'ky' ? `${n} сомдон` : `от ${n} сом`
  }
  return (
    <main className="site-page">
      <LangSwitch lang={lang} onChange={setLang} />
      <div className="site-hero">
        <img src={`${import.meta.env.BASE_URL}tooth.svg`} alt="" width={72} height={72} />
        <div><h1>{name}</h1><p>{t.tagline}</p></div>
      </div>
      <div className="site-actions">
        {d.telegramUrl && <a className="btn primary" href={d.telegramUrl} target="_blank" rel="noopener noreferrer">📲 {t.book}</a>}
        {d.whatsapp && <a className="btn" href={`https://wa.me/${d.whatsapp}?text=${encodeURIComponent(t.waText)}`} target="_blank" rel="noopener noreferrer">💬 {t.whatsapp}</a>}
        {d.phone && <a className="btn" href={`tel:+${d.phone}`}>📞 {t.call} {d.phoneText || formatPhone(d.phone)}</a>}
        {d.mapUrl && <a className="btn" href={d.mapUrl} target="_blank" rel="noopener noreferrer">🗺️ {t.map}</a>}
      </div>
      {d.address && <p>📍 {d.address}</p>}
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
