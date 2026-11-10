import { useState } from 'react'

import type { Schemas } from '../api/client'
import { dateOf, dayTitle, timeOf } from '../lib/time'
import { cancelledText } from './cancelled'

type Appointment = Schemas['AppointmentView']

/**
 * Отменённые приёмы — свёрнутой строкой «Отменено: N ›» внизу дня: в сетке они не занимают место, но
 * и не пропадают молча («было 4 пациента, вижу 2»). Раскрыть — время, пациент и кто отменил; нажать —
 * карточка приёма (там «Восстановить»). Нет отменённых — ничего не показываем.
 */
export function CancelledList({ items, onOpen, selectedId, doctorName, withDate, inline = false }: {
  items: Appointment[]
  onOpen: (a: Appointment) => void
  selectedId?: number
  /** «Все врачи» — имя врача у строки */
  doctorName?: (doctorId: number) => string
  /** «Неделя» — у строки ещё и день */
  withDate?: boolean
  /** В строке над сеткой дня (компьютер): маленькой ссылкой в конце строки, раскрытый список — строкой ниже */
  inline?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const sorted = [...items].sort((x, y) => (x.startAt ?? '').localeCompare(y.startAt ?? ''))
  return (
    <div className={inline ? 'cancelled inline' : 'cancelled'}>
      <button type="button" className="cancelled-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Отменено: {items.length} <span className="cancelled-caret" aria-hidden="true">{open ? '⌄' : '›'}</span>
      </button>
      {open && (
        <ul className="cancelled-list" aria-label="Отменённые записи">
          {sorted.map((a) => (
            <li key={a.id}>
              <button type="button" className={`cancelled-row${a.id === selectedId ? ' active' : ''}`} onClick={() => onOpen(a)}>
                <span className="time num">{withDate && a.startAt ? `${dayTitle(dateOf(a.startAt))}, ` : ''}{a.startAt ? timeOf(a.startAt) : ''}</span>
                <span className="name">
                  {a.patient?.fullName}
                  {doctorName && a.doctorId != null && <span className="hint"> · {doctorName(a.doctorId)}</span>}
                </span>
                <span className="cancelled-who hint">{cancelledText(a)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
