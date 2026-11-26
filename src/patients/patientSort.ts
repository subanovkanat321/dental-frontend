import type { Schemas } from '../api/client'

type Row = Schemas['PatientListControllerPatientRow']

/** По чему сортируем: заголовки колонок на компьютере и «Порядок» на телефоне — одно состояние. */
export type SortBy = 'name' | 'balance' | 'last' | 'next'
export type Sort = { by: SortBy; desc: boolean }

/** Нажали на заголовок впервые — в «естественную» сторону: имя А–Я, должники сверху, недавние, ближайшая запись. */
const FIRST_DESC: Record<SortBy, boolean> = { name: false, balance: false, last: true, next: false }

export function nextSort(sort: Sort, by: SortBy): Sort {
  return sort.by === by ? { by, desc: !sort.desc } : { by, desc: FIRST_DESC[by] }
}

/** Баланс пациента: аванс − долг; минус — должен. Нет сумм (не положено или ноль) — null. */
export function balanceOf(r: Row): number | null {
  const v = (r.advanceSom ?? 0) - (r.debtSom ?? 0)
  return v === 0 ? null : v
}

/** Сортировка; пустое (нет даты, нулевой баланс) — всегда в конце, в какую сторону ни сортируй. */
export function sortRows(rows: Row[], sort: Sort): Row[] {
  const value = (r: Row): string | number | null => {
    if (sort.by === 'name') return r.fullName || null
    if (sort.by === 'balance') return balanceOf(r)
    return (sort.by === 'next' ? r.nextVisit : r.lastVisit) ?? null
  }
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (x == null && y != null) return 1
    if (x != null && y == null) return -1
    if (x == null || y == null) return 0
    const order = typeof x === 'number' ? x - (y as number) : sort.by === 'name' ? x.localeCompare(String(y), 'ru') : x < y ? -1 : x > y ? 1 : 0
    return sort.desc ? -order : order
  })
}
