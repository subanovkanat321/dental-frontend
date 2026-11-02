import { somText } from '../lib/time'

export type HBarRow = { name: string; value: number; note?: string }

/**
 * Горизонтальные столбики «название — сумма», по убыванию; подпись значения — текстом рядом
 * (dataviz: ранжированные полосы одного цвета — части целого сравниваются точнее, чем в пироге).
 * С `onPick` строка — кнопка: нажатие выбирает её (например, фильтр списка), повторное — снимает.
 */
export function HBars({ rows, label, format = somText, picked, onPick }: {
  rows: HBarRow[]
  label: string
  format?: (v: number) => string
  picked?: string
  onPick?: (name: string) => void
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <ul className={onPick ? 'hbars pickable' : 'hbars'} aria-label={label}>
      {rows.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0
        const text = `${r.name}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`
        const body = (
          <>
            <span className="hbar-name">{r.name}</span>
            <span className="hbar-track" aria-hidden="true"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="hbar-value num">{format(r.value)}<span className="hint"> · {share}%</span></span>
          </>
        )
        return (
          <li key={r.name} title={text}>
            {onPick
              ? <button type="button" className={picked === r.name ? 'hbar-row picked' : 'hbar-row'} aria-pressed={picked === r.name} onClick={() => onPick(r.name)}>{body}</button>
              : body}
          </li>
        )
      })}
    </ul>
  )
}
