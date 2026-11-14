import type { ReactNode } from 'react'

import { useMedia } from '../lib/useMedia'
import { Select } from './Select'

/** Пункт переключателя: значение, вид в таблетке и текст для списка (если вид — не строка: число, значок). */
export type SegmentOption<T extends string> = { value: T; label: ReactNode; text?: string; title?: string }

/** Телефон — как у листа `Select`: на этой ширине длинный ряд таблеток не помещается. */
const PHONE = '(max-width: 640px)'
/** С стольких пунктов на телефоне — выпадающий список, а не таблетки (DESIGN.md → «Переключатели»). */
const SELECT_FROM = 4

/**
 * Переключатель-фильтр с длинным списком пунктов («Все · 12 | Планы лечения · 48 000 сом | Отменили · 3 | …»).
 * Компьютер — таблетки `.segments`, как везде. Телефон и {@link SELECT_FROM}+ пунктов — свой `Select`:
 * таблетки в одну строку стали бы по 50px с текстом в три строки, а переносом — пункт один во второй строке.
 * Короткие переключатели (2–3 пункта, «День / Неделя / Месяц») пишутся обычной разметкой `.segments` — их
 * в одну строку держит CSS (tokens.css).
 */
export function Segments<T extends string>({ label, options, value, onChange, className }: {
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const phone = useMedia(PHONE)
  if (phone && options.length >= SELECT_FROM) {
    return (
      <Select className={['segments-select', className].filter(Boolean).join(' ')} aria-label={label} value={value}
        onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.text ?? (typeof o.label === 'string' ? o.label : o.value)}</option>)}
      </Select>
    )
  }
  return (
    <div className={['segments', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}
