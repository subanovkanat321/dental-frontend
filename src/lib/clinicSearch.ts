import { useState } from 'react'

/**
 * Поиск клиники, когда их много: по названию и адресу (в каталоге — и по врачу) и по городу.
 * Общий для каталога /clinics (src/site/Directory.tsx) и выбора клиники в Mini App
 * (src/patient/PatientApp.tsx). Пока клиник мало, поиск и города не показываем — короткий
 * список и так виден целиком, а пустое поле поиска только отвлекает.
 */

/** Города — тот же закрытый список, что у бэкенда (ClinicCities.java, V121). */
export const CITIES = ['Бишкек', 'Ош', 'Джалал-Абад', 'Каракол', 'Токмок', 'Кара-Балта', 'Нарын', 'Талас', 'Баткен', 'Чолпон-Ата',
  'Кант', 'Балыкчы', 'Узген', 'Кара-Суу', 'Кызыл-Кия', 'Майлуу-Суу', 'Таш-Кумыр', 'Кара-Куль', 'Сокулук', 'Беловодское'] as const

/** Как город пишут по-кыргызски, где отличается. */
const KY: Record<string, string> = { 'Джалал-Абад': 'Жалал-Абад', Узген: 'Өзгөн', 'Кара-Куль': 'Кара-Көл', Беловодское: 'Петровка' }

export function cityName(city: string, lang: 'ru' | 'ky' = 'ru'): string {
  return lang === 'ky' ? KY[city] ?? city : city
}

/** Поиск появляется, когда клиник больше пяти; города — когда у клиник их хотя бы два. */
export const SEARCH_FROM = 6

const LETTER = 'А-Яа-яЁёA-Za-z'
const GUESS: [RegExp, string][] = [
  [/[Бб]ишкек/, 'Бишкек'],
  [new RegExp(`(^|[^${LETTER}])[Оо]ш($|[^${LETTER}])`), 'Ош'],
  [/[Дд]?[Жж]алал[- ]?[Аа]бад/, 'Джалал-Абад'],
  [/[Кк]аракол/, 'Каракол'],
  [/[Тт]окм[оа]к/, 'Токмок'],
  [/[Кк]ара[- ]?[Бб]алт/, 'Кара-Балта'],
  [/[Нн]арын/, 'Нарын'],
  [new RegExp(`(^|[^${LETTER}])[Тт]алас`), 'Талас'],
  [/[Бб]аткен/, 'Баткен'],
  [/[Чч]олпон[- ]?[Аа]т/, 'Чолпон-Ата'],
  [new RegExp(`(^|[^${LETTER}])[Кк]ант($|[^${LETTER}])`), 'Кант'],
]

/** Город из адреса — как в миграции V121: «г. Бишкек, …» → «Бишкек»; «ул. Кошоева» — не Ош. */
export function guessCity(address: string): string | null {
  return GUESS.find(([re]) => re.test(address))?.[1] ?? null
}

/** «📍 Ош, ул. Ленина 1»: город — впереди, если в адресе его нет (адрес «ул. Ленина 1» в каталоге многих городов неясен). */
export function withCity(address?: string | null, city?: string | null): string {
  if (!city) return address ?? ''
  if (!address) return city
  return address.toLowerCase().includes(city.toLowerCase()) ? address : `${city}, ${address}`
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е')

/** Все слова запроса есть в тексте клиники — без регистра и «ё»: «улыбка манаса», «петр». */
export function matchesQuery(fields: (string | null | undefined)[], query: string): boolean {
  const text = norm(fields.filter(Boolean).join(' '))
  return norm(query).split(/\s+/).filter(Boolean).every((w) => text.includes(w))
}

const KEY = 'clinics.city'

/** Выбранный город помним в браузере (не личные данные): вернулся — снова его клиники. */
function remembered(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

type Clinic = { city?: string | null }

/**
 * Поиск и город над списком клиник. `text` — по чему искать (название, адрес, врачи). Город,
 * которого в списке больше нет, не прячет все клиники — показываем все.
 */
export function useClinicFilter<C extends Clinic>(clinics: C[], text: (c: C) => (string | null | undefined)[]) {
  const [query, setQuery] = useState('')
  const [saved, setSaved] = useState(remembered)
  // Города с клиниками — по числу клиник, при равенстве — в порядке списка (Бишкек, Ош, …)
  const counts = new Map<string, number>()
  for (const c of clinics) if (c.city) counts.set(c.city, (counts.get(c.city) ?? 0) + 1)
  const order = (city: string) => (CITIES as readonly string[]).indexOf(city)
  const cities = [...counts].sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0])).map(([city, count]) => ({ city, count }))
  const showCities = cities.length >= 2
  const city = showCities && counts.has(saved) ? saved : ''
  const showSearch = clinics.length >= SEARCH_FROM
  const shown = clinics.filter((c) => (!city || c.city === city) && (!showSearch || matchesQuery([...text(c), c.city], query)))
  const setCity = (next: string) => {
    setSaved(next)
    try {
      if (next) localStorage.setItem(KEY, next)
      else localStorage.removeItem(KEY)
    } catch {
      // приватный режим — просто не запомним
    }
  }
  return { query, setQuery, city, setCity, cities, showCities, showSearch, shown, filtered: Boolean(city || (showSearch && query.trim())) }
}
