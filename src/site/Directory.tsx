import { useEffect, useState } from 'react'

import { LangSwitch } from './ClinicSite'
import { getJson, initials, matches, useSiteLang, type DirectoryClinic } from './web'

const TEXTS = {
  ru: {
    title: 'Запись к стоматологу', tagline: 'Выберите клинику или врача и запишитесь в Telegram за минуту — бот напомнит о приёме 😊',
    search: 'Клиника, врач или адрес', book: 'Записаться в Telegram', more: 'Врачи, услуги и цены', map: 'На карте', doctors: 'Врачи',
    clinic: 'Стоматология', nothing: 'Ничего не нашлось — попробуйте другое слово.', empty: 'Клиники скоро появятся здесь.',
    forClinics: 'Для клиник', login: 'Вход для клиники', join: 'Подключить клинику',
    error: 'Не удалось загрузить список — обновите страницу через минуту.', loading: 'Загрузка…',
  },
  ky: {
    title: 'Тиш дарыгерине жазылуу', tagline: 'Клиниканы же дарыгерди тандап, Telegram аркылуу бир мүнөттө жазылыңыз — бот эскертет 😊',
    search: 'Клиника, дарыгер же дарек', book: 'Telegram аркылуу жазылуу', more: 'Дарыгерлер, кызматтар жана баалар', map: 'Картада', doctors: 'Дарыгерлер',
    clinic: 'Стоматология', nothing: 'Эч нерсе табылган жок — башка сөз менен издеңиз.', empty: 'Клиникалар жакында ушул жерде болот.',
    forClinics: 'Клиникалар үчүн', login: 'Клиника үчүн кирүү', join: 'Клиниканы туташтыруу',
    error: 'Тизме жүктөлгөн жок — бир мүнөттөн кийин жаңыртыңыз.', loading: 'Жүктөлүүдө…',
  },
}

/** Общий каталог /clinics: клиники и врачи, к кому можно записаться. Без Telegram и входа. */
export function Directory() {
  const [lang, setLang] = useSiteLang()
  const t = TEXTS[lang]
  const [clinics, setClinics] = useState<DirectoryClinic[] | null | 'error'>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    void getJson<DirectoryClinic[]>('/web/clinics').then(({ data }) => setClinics(data ?? 'error'))
  }, [])
  useEffect(() => {
    document.title = t.title
  }, [t.title])
  const found = Array.isArray(clinics) ? clinics.filter((c) => matches(c, query)) : []
  return (
    <main className="site-page">
      <LangSwitch lang={lang} onChange={setLang} />
      <div className="site-hero">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={95} height={90} />
        <div><h1>{t.title}</h1><p>{t.tagline}</p></div>
      </div>
      {clinics === 'error' ? <p className="site-message">{t.error}</p> : clinics === null ? <p className="site-message hint">{t.loading}</p> : (
        <>
          {clinics.length > 3 && <input type="search" className="site-search" placeholder={t.search} aria-label={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />}
          {clinics.length === 0 ? <p className="site-message">{t.empty}</p> : found.length === 0 ? <p className="site-message">{t.nothing}</p> : found.map((c) => (
            <article key={c.pageUrl} className="site-card">
              <h2>{c.name || t.clinic}</h2>
              {c.address && <p>📍 {c.address}{c.mapUrl && <> · <a href={c.mapUrl} target="_blank" rel="noopener noreferrer">{t.map}</a></>}</p>}
              {c.doctors.length > 0 && (
                <ul className="site-list" aria-label={t.doctors}>
                  {c.doctors.map((d) => (
                    <li key={d.fullName} className="site-doctor small">
                      {d.photoUrl ? <img src={d.photoUrl} alt="" width={40} height={40} /> : <span className="initials" aria-hidden="true">{initials(d.fullName)}</span>}
                      <span><strong>{d.fullName}</strong>{d.about && <span className="hint">{d.about}</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="site-actions">
                {c.telegramUrl && <a className="btn primary" href={c.telegramUrl} target="_blank" rel="noopener noreferrer">📲 {t.book}</a>}
                <a className="btn" href={c.pageUrl}>🦷 {t.more}</a>
              </div>
            </article>
          ))}
        </>
      )}
      <footer className="site-footer">{t.forClinics}: <a href="/login">{t.login}</a> · <a href="/join">{t.join}</a></footer>
    </main>
  )
}
