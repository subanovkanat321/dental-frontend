import { useEffect, useRef, useState } from 'react'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** '2026-11' + 1 → '2026-12'; '2026-12' + 1 → '2027-01'. */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const index = y! * 12 + (m! - 1) + by
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** '2026-11' → «Ноябрь 2026». */
function monthName(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`
}

/**
 * Выбор месяца «‹ Ноябрь 2026 ›»: стрелки — на месяц назад и вперёд, нажатие на название —
 * окошко с годом и двенадцатью месяцами. Один вид во всех вкладках «Кассы» и в «Складе»
 * вместо поля месяца браузера («2026-10» и значок календаря).
 */
export function MonthPicker({ value, onChange, max, label }: {
  /** 'YYYY-MM' */
  value: string
  onChange: (month: string) => void
  /** Последний месяц, который можно выбрать (обычно текущий) */
  max?: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Number(value.slice(0, 4)))
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const next = shiftMonth(value, 1)
  const maxYear = max ? Number(max.slice(0, 4)) : Infinity
  const pick = (month: string) => {
    onChange(month)
    setOpen(false)
  }
  return (
    <div className="month-picker" role="group" aria-label={label} ref={box}>
      <button type="button" className="mp-step" aria-label="Предыдущий месяц" onClick={() => onChange(shiftMonth(value, -1))}>‹</button>
      <button type="button" className="mp-current" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setYear(Number(value.slice(0, 4))); setOpen(!open) }}>
        {monthName(value)} <span className="mp-caret" aria-hidden="true">▾</span>
      </button>
      <button type="button" className="mp-step" aria-label="Следующий месяц" disabled={max != null && next > max} onClick={() => onChange(next)}>›</button>
      {open && (
        <div className="mp-pop" role="dialog" aria-label="Выбор месяца">
          <div className="mp-year">
            <button type="button" className="mp-step" aria-label="Предыдущий год" onClick={() => setYear(year - 1)}>‹</button>
            <b>{year}</b>
            <button type="button" className="mp-step" aria-label="Следующий год" disabled={year + 1 > maxYear} onClick={() => setYear(year + 1)}>›</button>
          </div>
          <div className="mp-grid">
            {SHORT.map((name, i) => {
              const month = `${year}-${String(i + 1).padStart(2, '0')}`
              return (
                <button key={month} type="button" aria-label={monthName(month)} aria-pressed={month === value}
                  disabled={max != null && month > max} onClick={() => pick(month)}>{name}</button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
