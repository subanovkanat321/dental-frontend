import { useEffect } from 'react'

import type { Schemas } from '../api/client'
import { shortName } from '../lab/text'
import { dateOf, shortDay, timeOf } from '../lib/time'

type Appointment = Schemas['AppointmentView']

/** Сколько держать тост: прочитать и успеть нажать «Открыть». */
const SHOW_MS = 8000

/** «Записано: пт 20 нояб, 13:00 · Бакыт Т.» — день по Бишкеку, пациент коротко. */
function bookedText(a: Appointment): string {
  const who = a.patient?.fullName ? ` · ${shortName(a.patient.fullName)}` : ''
  return `Записано: ${shortDay(dateOf(a.startAt))}, ${timeOf(a.startAt)}${who}`
}

/**
 * После «Записать» форма закрывается, а внизу — тост «Записано: пт 20 нояб, 13:00 · Бакыт Т. — Открыть» (UX-аудит
 * 2026-11-20): сетка снова на виду, а карточка записи — одним нажатием. Сам исчезает через 8 секунд.
 */
export function BookedToast({ appointment, onOpen, onClose }: { appointment: Appointment; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, SHOW_MS)
    return () => window.clearTimeout(t)
  }, [appointment, onClose])
  return (
    <div className="booked-toast" role="status">
      <span className="booked-toast-text">{bookedText(appointment)}</span>
      <button type="button" className="link" onClick={onOpen}>Открыть</button>
      <button type="button" className="btn ghost small" aria-label="Скрыть" onClick={onClose}>✕</button>
    </div>
  )
}
