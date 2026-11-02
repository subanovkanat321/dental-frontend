import { useEffect, useState } from 'react'

import { ClinicFilters } from '../lib/ClinicFilters'
import { useClinicFilter, withCity } from '../lib/clinicSearch'
import { InAppHint, LangSwitch } from './ClinicSite'
import { getJson, inAppBrowser, initials, tgLink, useSiteLang, type DirectoryClinic } from './web'

const TEXTS = {
  ru: {
    title: 'Запись к стоматологу', tagline: 'Выберите клинику или врача и запишитесь в Telegram за минуту — бот напомнит о приёме 😊',
    search: 'Клиника, врач или адрес', cities: 'Город', allCities: 'Все города', showAll: 'Показать все клиники', book: 'Записаться в Telegram', more: 'Врачи, услуги и цены', map: 'На карте', doctors: 'Врачи',
    clinic: 'Стоматология', nothing: 'Ничего не нашлось — попробуйте другое слово.', empty: 'Клиники скоро появятся здесь.',
    forClinics: 'Для клиник', login: 'Вход для клиники', join: 'Подключить клинику',
    staff: 'Вы врач или администратор клиники?', staffLogin: 'Войти в CRM',
    error: 'Не удалось загрузить список — обновите страницу через минуту.', loading: 'Загрузка…',
    inAppTop: 'Открыли из Instagram? Если Telegram не открывается — нажмите ⋮ вверху → «Открыть в браузере» или «📲 открыть Telegram» у клиники.', openTg: 'открыть Telegram',
  },
  ky: {
    title: 'Тиш дарыгерине жазылуу', tagline: 'Клиниканы же дарыгерди тандап, Telegram аркылуу бир мүнөттө жазылыңыз — бот эскертет 😊',
    search: 'Клиника, дарыгер же дарек', cities: 'Шаар', allCities: 'Бардык шаарлар', showAll: 'Бардык клиникаларды көрсөтүү', book: 'Telegram аркылуу жазылуу', more: 'Дарыгерлер, кызматтар жана баалар', map: 'Картада', doctors: 'Дарыгерлер',
    clinic: 'Стоматология', nothing: 'Эч нерсе табылган жок — башка сөз менен издеңиз.', empty: 'Клиникалар жакында ушул жерде болот.',
    forClinics: 'Клиникалар үчүн', login: 'Клиника үчүн кирүү', join: 'Клиниканы туташтыруу',
    staff: 'Сиз клиниканын дарыгерисизби же администраторусузбу?', staffLogin: 'CRMге кирүү',
    error: 'Тизме жүктөлгөн жок — бир мүнөттөн кийин жаңыртыңыз.', loading: 'Жүктөлүүдө…',
    inAppTop: 'Instagram’дан ачтыңызбы? Telegram ачылбаса — жогорудагы ⋮ → «Браузерде ачуу» же клиниканын «📲 Telegram’ды ачуу» баскычын басыңыз.', openTg: 'Telegram’ды ачуу',
  },
}

/** Общий каталог /clinics: клиники и врачи, к кому можно записаться. Без Telegram и входа. */
export function Directory() {
  const [lang, setLang] = useSiteLang()
  const t = TEXTS[lang]
  const [clinics, setClinics] = useState<DirectoryClinic[] | null | 'error'>(null)
  useEffect(() => {
    void getJson<DirectoryClinic[]>('/web/clinics').then(({ data }) => setClinics(data ?? 'error'))
  }, [])
  useEffect(() => {
    document.title = t.title
  }, [t.title])
  const filter = useClinicFilter(Array.isArray(clinics) ? clinics : [], (c) => [c.name, c.address, ...c.doctors.map((d) => d.fullName)])
  const found = filter.shown
  return (
    <main className="site-page">
      {/* Сотрудники клиник набирают tish.kg и попадают сюда — вход в CRM сразу видно, а не только внизу */}
      <a className="site-staff" href="/login"><span>{t.staff}</span><strong>{t.staffLogin} →</strong></a>
      <LangSwitch lang={lang} onChange={setLang} />
      <div className="site-hero">
        <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="" width={95} height={90} />
        <div><h1>{t.title}</h1><p>{t.tagline}</p></div>
      </div>
      <InAppHint text={t.inAppTop} link="" />
      {clinics === 'error' ? <p className="site-message">{t.error}</p> : clinics === null ? <p className="site-message hint">{t.loading}</p> : (
        <>
          <ClinicFilters filter={filter} texts={t} lang={lang} />
          {clinics.length === 0 ? <p className="site-message">{t.empty}</p> : found.length === 0 ? (
            <div className="site-message">
              <p>{t.nothing}</p>
              <button type="button" className="btn" onClick={() => { filter.setQuery(''); filter.setCity('') }}>{t.showAll}</button>
            </div>
          ) : found.map((c) => (
            <article key={c.pageUrl} className="site-card">
              <h2>{c.name || t.clinic}</h2>
              {(c.address || c.city) && <p>📍 {withCity(c.address, c.city)}{c.mapUrl && <> · <a href={c.mapUrl} target="_blank" rel="noopener noreferrer">{t.map}</a></>}</p>}
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
              {c.telegramUrl && inAppBrowser() && tgLink(c.telegramUrl) && <a className="site-inapp-link" href={tgLink(c.telegramUrl)!}>📲 {t.openTg}</a>}
            </article>
          ))}
        </>
      )}
      <footer className="site-footer">{t.forClinics}: <a href="/login">{t.login}</a> · <a href="/join">{t.join}</a></footer>
    </main>
  )
}
