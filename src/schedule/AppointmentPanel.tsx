import { useEffect } from 'react'

import type { Schemas } from '../api/client'
import { dayTitle, formatPhone, somText, timeOf, todayIn } from '../lib/time'
import { statusOf } from './status'

type Appointment = Schemas['AppointmentView']
type Doctor = Schemas['DoctorView']

const METHOD: Record<string, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта' }

/**
 * Карточка приёма справа: кто, когда, к кому, статус, оплата. Esc — закрыть. Действия (отметить,
 * перенести, оплата) — пока «Открыть в приложении»: перенесём на следующих этапах.
 */
export function AppointmentPanel({ appointment: a, doctors, onClose }: { appointment: Appointment; doctors: Doctor[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const s = statusOf(a)
  const doctor = doctors.find((d) => d.id === a.doctorId)
  const date = a.startAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date(a.startAt)) : todayIn()
  return (
    <aside className="panel" aria-label="Карточка приёма">
      <header className="panel-head">
        <div>
          <h2>{timeOf(a.startAt!)}–{timeOf(a.endAt!)}</h2>
          <span className="hint">{dayTitle(date)}{doctor ? ` · ${doctor.fullName}` : ''}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <section>
        <strong className="patient-name">{a.patient?.fullName}</strong>
        {a.patient?.phone && <a href={`tel:+${a.patient.phone}`}>{formatPhone(a.patient.phone)}</a>}
      </section>
      <p className={`status tone-${s.tone}`}>{s.icon} {s.label}</p>
      {a.serviceName && <p>🦷 {a.serviceName}</p>}
      {a.comment && <p className="hint">💬 {a.comment}</p>}
      {a.paidSom != null && (
        <p>💰 {somText(a.paidSom)}{a.paymentMethod ? ` · ${METHOD[a.paymentMethod] ?? a.paymentMethod}` : ''}
          {a.debtSom ? <span className="tone-wait"> · долг {somText(a.debtSom)}</span> : null}</p>
      )}
      {a.depositStatus && <p className="hint">💳 Предоплата {somText(a.depositSom ?? 0)}</p>}
      <a className="btn primary" href={`/?appointment=${a.id}`} target="_blank" rel="noopener">Открыть в приложении</a>
      <p className="hint small">Отметить приём, оплату и перенос — пока в приложении. В CRM появятся на следующих этапах.</p>
    </aside>
  )
}
