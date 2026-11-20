import { addDays } from '../lib/time'

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long' })
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const at0 = (d: string) => new Date(`${d}T00:00:00Z`)

/** «Сегодня» / «Завтра» / «Вчера» или день недели; ниже — «понедельник, 2 ноября». */
function dateBarTitle(date: string, today: string): { main: string; sub: string } {
  const near = date === today ? 'Сегодня' : date === addDays(today, 1) ? 'Завтра' : date === addDays(today, -1) ? 'Вчера' : null
  const weekday = WEEKDAY.format(at0(date))
  const dayMonth = DAY_MONTH.format(at0(date))
  return near ? { main: near, sub: `${weekday}, ${dayMonth}` } : { main: weekday.replace(/^./, (x) => x.toUpperCase()), sub: dayMonth }
}

/**
 * Один день крупно — как на главной (список «День»): ‹ · «Сегодня ▾ / пятница, 20 ноября» · › и «Сегодня», если ушли
 * с сегодняшнего. Нажать на дату — свой выбор дня (onPick) или системный календарь (скрытое поле даты поверх кнопки).
 * Общий для «Кассы дня» и других экранов «за день» (2026-11-20, просьба владельца).
 */
export function DateBar({ date, today, onDate, max, label = 'День' }: {
  date: string
  today: string
  onDate: (date: string) => void
  /** Позже этого дня не листать (касса — не дальше сегодня) */
  max?: string
  label?: string
}) {
  const title = dateBarTitle(date, today)
  const nextOff = max != null && date >= max
  return (
    <div className="date-bar" role="group" aria-label={label}>
      <button type="button" className="date-step" aria-label="Предыдущий день" onClick={() => onDate(addDays(date, -1))}>‹</button>
      <label className="date-pick">
        <span className="date-main">{title.main} <span className="date-caret" aria-hidden="true">▾</span></span>
        <span className="date-sub">{title.sub}</span>
        <input type="date" className="date-pick-input" aria-label={`${title.main}, ${title.sub}: выбрать день`} value={date} max={max}
          onChange={(e) => e.target.value && onDate(e.target.value)} />
      </label>
      <button type="button" className="date-step" aria-label="Следующий день" disabled={nextOff} onClick={() => onDate(addDays(date, 1))}>›</button>
      {date !== today && <button type="button" className="btn small date-today" onClick={() => onDate(today)}>Сегодня</button>}
    </div>
  )
}
