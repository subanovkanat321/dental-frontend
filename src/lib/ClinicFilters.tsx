import { cityName, type useClinicFilter } from './clinicSearch'

type Texts = { search: string; cities: string; allCities: string }

/**
 * Поиск и города над списком клиник (каталог /clinics и выбор клиники в Mini App). Показывается
 * только то, что помогает: поиск — от шести клиник, города — если их хотя бы два.
 */
export function ClinicFilters({ filter: f, texts: t, lang }: { filter: ReturnType<typeof useClinicFilter>; texts: Texts; lang: 'ru' | 'ky' }) {
  if (!f.showSearch && !f.showCities) return null
  return (
    <div className="clinic-filters">
      {f.showSearch && (
        <label className="clinic-search-box">
          <span className="clinic-search-icon" aria-hidden="true">🔍</span>
          <input type="search" className="clinic-search" placeholder={t.search} aria-label={t.search} value={f.query}
            enterKeyHint="search" onChange={(e) => f.setQuery(e.target.value)}
            // «Найти» на клавиатуре телефона — закрыть клавиатуру, чтобы увидеть список
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        </label>
      )}
      {f.showCities && (
        <div className="city-filter">
          <span className="city-filter-label" aria-hidden="true">📍 {t.cities}</span>
          {/* Городов немного — переносятся на новую строку, а не прячутся за край экрана */}
          <div className="city-chips" role="group" aria-label={t.cities}>
            <button type="button" aria-pressed={!f.city} onClick={() => f.setCity('')}>{t.allCities}</button>
            {f.cities.map(({ city, count }) => (
              <button key={city} type="button" aria-pressed={f.city === city} onClick={() => f.setCity(f.city === city ? '' : city)}>
                {cityName(city, lang)} <span className="count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
