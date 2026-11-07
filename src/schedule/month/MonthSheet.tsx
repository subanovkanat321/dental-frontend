import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBack } from '../../lib/back'
import { MonthGrid } from './MonthGrid'
import { addMonths, monthTitle } from './monthModel'
import { useMonthData } from './useMonth'

/**
 * Телефон: нажали на дату в «Дне» — снизу лист с месяцем, как вид «Месяц»: в ячейке число записей и
 * полоска загрузки выбранных врачей, нерабочие дни штриховкой. Стрелки — соседний месяц; нажали на
 * день — он открывается в «Дне», лист закрывается. Отдельный переключатель «День | Месяц» не нужен.
 */
export function MonthSheet({ date, today, doctorIds, onPick, onClose }: {
  date: string
  today: string
  doctorIds: number[]
  onPick: (date: string) => void
  onClose: () => void
}) {
  const [month, setMonth] = useState(date.slice(0, 7))
  const data = useMonthData(month, doctorIds, true)
  useBack(onClose)
  // Esc на клавиатуре — тоже закрыть (как календарь DateInput)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const pick = (day: string) => {
    onPick(day)
    onClose()
  }
  return createPortal(
    <div className="ui-select-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="month-sheet" role="dialog" aria-modal="true" aria-label="Выбрать день">
        <div className="month-sheet-head">
          <button type="button" className="date-step" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
          <b>{monthTitle(month)}</b>
          <button type="button" className="date-step" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(month, 1))}>›</button>
        </div>
        <MonthGrid month={month} today={today} selected={date} data={data} compact onOpenDay={pick} />
        <div className="month-sheet-foot">
          {date !== today && <button type="button" className="btn" onClick={() => pick(today)}>Сегодня</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
