import { useState, type ReactNode } from 'react'

import { useMedia } from '../lib/useMedia'
import { Select } from './Select'
import { Sheet } from './Sheet'

/**
 * Пункт переключателя: значение, вид в таблетке и текст для списка (если вид — не строка: число, значок).
 * С icon и name — на телефоне «богатый» выбор листом снизу ({@link ChoiceSheet}): значок, название, пояснение (hint)
 * и число (count) справа.
 */
export type SegmentOption<T extends string> = {
  value: T; label: ReactNode; text?: string; title?: string
  icon?: string; name?: string; hint?: string; count?: string
}

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
  if (phone && options.length >= SELECT_FROM && options.every((o) => o.icon && o.name)) {
    return <ChoicePick label={label} options={options} value={value} onChange={onChange} className={className} />
  }
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

/**
 * Телефон: поле с выбранным пунктом (значок, название, число) и лист снизу с карточками пунктов — значок в цветном
 * круге, название, серое пояснение, число справа, выбранный — рамкой и ✓ (2026-11-23, владелец: «сделай красивее»).
 */
function ChoicePick<T extends string>({ label, options, value, onChange, className }: {
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value) ?? options[0]!
  return (
    <>
      <button type="button" className={['choice-pick', className].filter(Boolean).join(' ')} aria-haspopup="dialog"
        aria-label={`${label}: ${current.name}${current.count ? ` · ${current.count}` : ''}`} onClick={() => setOpen(true)}>
        <span className="choice-icon" aria-hidden="true">{current.icon}</span>
        <span className="choice-name">{current.name}</span>
        {current.count && <span className="choice-count num">{current.count}</span>}
        <span className="choice-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <Sheet label={label} title={label} onClose={() => setOpen(false)}>
          <ul className="choice-list" role="listbox" aria-label={label}>
            {options.map((o) => (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={o.value === value} className="choice-item"
                  onClick={() => { setOpen(false); onChange(o.value) }}>
                  <span className="choice-icon" aria-hidden="true">{o.icon}</span>
                  <span className="choice-text"><span className="choice-name">{o.name}</span>{o.hint && <span className="choice-hint">{o.hint}</span>}</span>
                  {o.count && <span className="choice-count num">{o.count}</span>}
                  {o.value === value && <span className="choice-check" aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  )
}
