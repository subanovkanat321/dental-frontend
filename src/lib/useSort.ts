import { useMemo, useState } from 'react'

export type Sort<K extends string> = { key: K; desc: boolean }

/**
 * Сортировка таблицы: по какой колонке и в какую сторону. Пустые значения — всегда в конце, в какую
 * сторону ни сортируй. Строки — по-русски («ё» рядом с «е»), числа и даты (ISO) — как есть.
 */
export function useSort<T, K extends string>(rows: T[], value: (row: T, key: K) => string | number | null | undefined, initial: Sort<K>) {
  const [sort, setSort] = useState<Sort<K>>(initial)
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = value(a, sort.key)
    const y = value(b, sort.key)
    const emptyX = x == null || x === ''
    const emptyY = y == null || y === ''
    if (emptyX || emptyY) return emptyX === emptyY ? 0 : emptyX ? 1 : -1
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru')
    return sort.desc ? -order : order
  }), [rows, sort, value])
  /** Нажали на заголовок: та же колонка — другая сторона; новая — с её стороны по умолчанию. */
  const toggle = (key: K, desc = false) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : desc }))
  return { sorted, sort, toggle }
}
