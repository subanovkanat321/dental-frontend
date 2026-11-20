import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { matches } from '../lib/useMedia'
import { useSwipeDown } from '../layout/useSwipeDown'
import { addMonths, monthGridDays, monthTitle } from './month/monthModel'
import { freeText, useDoctorMonth, type CalDay } from './doctorMonth'
import './doctorCalendar.css'

const WEEK = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** Коротко для клетки: «3 ч», «45 м» — полный текст в подсказке и имени кнопки. */
function freeShort(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч` : `${minutes} м`
}

function dayLabel(date: string, day: CalDay | undefined): string {
  const title = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'short' }).format(new Date(`${date}T00:00:00Z`))
  if (!day) return title
  switch (day.kind) {
    case 'work': return `${title}: работает, свободно ${freeText(day.freeMinutes)}`
    case 'full': return `${title}: работает, свободного времени нет`
    case 'off': case 'past-off': return `${title}: ${day.note ? day.note.toLowerCase() : 'выходной'}`
    case 'past-work': return `${title}: работал`
    default: return title
  }
}

/**
 * Мини-календарь врача (шаг 6А, как у Dentist Plus по нажатию на шапку врача): месяц, рабочие дни подсвечены,
 * выходные и отпуска — штриховкой, у рабочего дня — сколько свободно. Нажали на день — он открывается в «Дне».
 * Компьютер — всплывающее окно под шапкой колонки (Esc и нажатие мимо закрывают), телефон — лист снизу.
 * «Только этот врач» — прежнее действие шапки колонки (показать одну колонку) теперь здесь.
 */
export function DoctorCalendar({ doctor, date, today, anchor, onPick, onOnly, onClose }: {
  doctor: { id: number; name: string; color: string }
  /** Открытый день — с его месяца календарь начинается, он обведён */
  date: string
  today: string
  /** Компьютер: прямоугольник шапки, под которой открыться; null — лист снизу (телефон) */
  anchor: DOMRect | null
  onPick: (date: string) => void
  /** «Только этот врач» в «Дне» (в «Все врачи», где колонок несколько); нет — кнопки нет */
  onOnly?: () => void
  onClose: () => void
}) {
  const [month, setMonth] = useState(date.slice(0, 7))
  const days = useDoctorMonth(doctor.id, month)
  const box = useRef<HTMLDivElement>(null)
  const sheet = anchor == null || matches('(max-width: 640px)')
  useBack(onClose)
  useSwipeDown(box, sheet ? onClose : null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { box.current?.focus({ preventScroll: true }) }, [])
  // Компьютер: не вылезти за правый и нижний край окна
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined)
  useLayoutEffect(() => {
    if (sheet || !anchor) return
    const w = box.current?.offsetWidth || 300
    const h = box.current?.offsetHeight || 360
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8))
    const below = anchor.bottom + 6
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : below
    setPos({ left, top })
  }, [sheet, anchor, month])
  const pick = (day: string) => {
    onPick(day)
    onClose()
  }
  const grid = monthGridDays(month)
  const working = days ? Object.entries(days).filter(([d, x]) => x.kind === 'work' && d >= today).length : null

  const body = (
    <div ref={box} role="dialog" aria-modal={sheet} aria-label={`Календарь врача: ${doctor.name}`} tabIndex={-1}
      className={sheet ? 'doc-cal sheet' : 'doc-cal pop'} style={{ ...pos, '--doc': doctor.color } as CSSProperties}>
      <div className="doc-cal-head">
        <span className="doc-cal-name"><i className="doc-cal-dot" aria-hidden="true" />{doctor.name}</span>
        <button type="button" className="btn ghost small doc-cal-close" aria-label="Закрыть календарь" onClick={onClose}>✕</button>
      </div>
      <div className="doc-cal-month">
        <button type="button" className="btn ghost small" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <b>{monthTitle(month)}</b>
        <button type="button" className="btn ghost small" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(month, 1))}>›</button>
      </div>
      <div className="doc-cal-grid" role="group" aria-label={monthTitle(month)}>
        {WEEK.map((w) => <span key={w} className="doc-cal-wd" aria-hidden="true">{w}</span>)}
        {grid.map((d) => {
          const day = days?.[d]
          const other = !d.startsWith(month)
          const cls = ['doc-cal-day', day ? `k-${day.kind}` : 'k-loading', other ? 'other' : '', d === today ? 'today' : '', d === date ? 'selected' : ''].filter(Boolean).join(' ')
          return (
            <button key={d} type="button" className={cls} aria-label={dayLabel(d, day)} title={dayLabel(d, day)}
              aria-current={d === date ? 'date' : undefined} onClick={() => pick(d)}>
              <span className="doc-cal-num">{Number(d.slice(8))}</span>
              {day?.kind === 'work' && !other && <span className="doc-cal-free">{freeShort(day.freeMinutes)}</span>}
            </button>
          )
        })}
      </div>
      <p className="doc-cal-legend hint">
        <span><i className="sw work" aria-hidden="true" /> работает</span>
        <span><i className="sw off" aria-hidden="true" /> выходной, отпуск</span>
        <span>«3 ч» — свободно</span>
      </p>
      <div className="doc-cal-foot">
        {working != null && <span className="hint">{working ? `Дней со свободным временем: ${working}` : 'Свободных дней в этом месяце нет'}</span>}
        {onOnly && <button type="button" className="btn small" onClick={() => { onOnly(); onClose() }}>Только {doctor.name.split(/\s+/)[0]}</button>}
      </div>
    </div>
  )
  return createPortal(
    sheet
      ? <div className="ui-select-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>{body}</div>
      : <div className="doc-cal-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>{body}</div>,
    document.body,
  )
}
