import type { Sort } from '../lib/useSort'

/** Заголовок колонки, по которому сортируют: стрелка показывает сторону, aria-sort — для экранного диктора. */
export function SortTh<K extends string>({ k, title, sort, onSort, desc = false, right = false }: {
  k: K
  title: string
  sort: Sort<K>
  onSort: (key: K, desc?: boolean) => void
  /** С какой стороны начинать: даты и суммы — сначала новые и большие. */
  desc?: boolean
  right?: boolean
}) {
  const active = sort.key === k
  return (
    <th className={right ? 'r' : undefined} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => onSort(k, desc)}>
        {title}{active ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )
}
