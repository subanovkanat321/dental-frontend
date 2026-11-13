import { useState } from 'react'

/**
 * Фильтр «Платформа → Клиники»: город («Все», город, «Без города»), статус (здоровье клиники или
 * «не подписали договор») и поиск по названию. Город и статус помнит этот браузер (localStorage — не
 * ПДн: только город и код статуса); поиск — нет: вернулись — видно весь список города.
 */

/** Город: ALL — все; NONE — клиники без города; иначе — название из справочника. */
export const ALL = '*'
export const NONE = '-'

/** Статус: '' — любой; код здоровья (OK, QUIET, ASLEEP, NEW) или UNSIGNED — не подписали договор. */
export const UNSIGNED = 'UNSIGNED'

export type ClinicFilter = { city: string; status: string }

const KEY = 'tish.platform.clinics.filter'
const EMPTY: ClinicFilter = { city: ALL, status: '' }

function read(): ClinicFilter {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ClinicFilter> | null
    return {
      city: typeof saved?.city === 'string' && saved.city ? saved.city : ALL,
      status: typeof saved?.status === 'string' ? saved.status : '',
    }
  } catch {
    return EMPTY
  }
}

function write(next: ClinicFilter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Приватный режим или запрещено — просто не запомним
  }
}

/** Выбор города и статуса — с памятью в этом браузере. */
export function useClinicFilter(): [ClinicFilter, (patch: Partial<ClinicFilter>) => void] {
  const [filter, setFilter] = useState(read)
  const update = (patch: Partial<ClinicFilter>) => {
    const next = { ...filter, ...patch }
    write(next)
    setFilter(next)
  }
  return [filter, update]
}

/** Город клиники как ключ фильтра: пусто — «Без города». */
export function cityKey(city?: string | null): string {
  return city?.trim() || NONE
}

/**
 * Чипы городов: [ключ, подпись, сколько] — больше клиник выше, при равенстве по алфавиту; «Без города» —
 * последним. Выбранный город, которого уже нет в списке (клинику удалили), — с нулём: снять выбор видно.
 */
export function cityChips(cities: (string | null | undefined)[], selected: string): [string, string, number][] {
  const counts = new Map<string, number>()
  for (const c of cities) counts.set(cityKey(c), (counts.get(cityKey(c)) ?? 0) + 1)
  if (selected !== ALL && !counts.has(selected)) counts.set(selected, 0)
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => (a === NONE ? 1 : b === NONE ? -1 : y - x || a.localeCompare(b, 'ru')))
    .map(([key, n]) => [key, key === NONE ? 'Без города' : key, n])
}

/** Подходит ли название под поиск: без регистра и «ё». */
export function nameMatches(name: string | null | undefined, query: string): boolean {
  const norm = (s: string) => s.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim()
  const q = norm(query)
  return !q || norm(name ?? '').includes(q)
}
