import { useEffect } from 'react'

import type { Schemas } from '../api/client'
import { dayTitle, formatPhone, somText, timeOf, todayIn, ZONE } from '../lib/time'
import { PaymentBox } from './PaymentBox'
import { statusOf } from './status'
import { useAppointmentAction } from './useAppointmentAction'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Status = Schemas['AppointmentRequestsChangeStatus']['status']

/** День приёма по Бишкеку: 'YYYY-MM-DD'. */
function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

/**
 * Карточка приёма справа: кто, когда, к кому, статус и действия — как в «Дне» Mini App:
 * заявку подтвердить, приём отметить (состоялся / неявка), отменить, принять оплату. Esc — закрыть.
 */
export function AppointmentPanel({ appointment: a, me, onClose }: { appointment: Appointment; me: Me; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const action = useAppointmentAction(a)
  const s = statusOf(a)
  const doctor = (me.doctors ?? []).find((d) => d.id === a.doctorId)
  const date = a.startAt ? dateOf(a.startAt) : todayIn()
  // «Состоялся» сервер разрешает с дня приёма: будущий приём ещё не мог пройти
  const started = date <= todayIn()

  const setStatus = (status: Status, question?: string) => {
    if (question && !window.confirm(question)) return
    action.mutate({ kind: 'status', body: { version: a.version ?? 0, status } })
  }

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
      <span className={`chip s-${s.kind}`}><span className="dot" />{s.label}</span>
      {a.serviceName && <p><span className="hint">Услуга:</span> {a.serviceName}</p>}
      {a.comment && <p className="comment">{a.comment}</p>}
      {a.depositStatus && a.paidSom == null && <p className="hint">Предоплата {somText(a.depositSom ?? 0)}</p>}

      {a.status === 'REQUESTED' && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('SCHEDULED')}>Подтвердить</button>
          <button type="button" className="btn" disabled={action.isPending}
            onClick={() => setStatus('CANCELLED', 'Отклонить заявку? Пациенту придёт сообщение.')}>Отклонить</button>
        </div>
      )}
      {a.status === 'SCHEDULED' && (
        <div className="actions">
          {started && <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('DONE')}>Приём состоялся</button>}
          {started && <button type="button" className="btn" disabled={action.isPending} onClick={() => setStatus('NO_SHOW')}>Неявка</button>}
          <button type="button" className="btn danger" disabled={action.isPending}
            onClick={() => setStatus('CANCELLED', `Отменить запись ${a.patient?.fullName ?? ''}? Время освободится.`)}>Отменить запись</button>
        </div>
      )}
      {action.error && <p className="error" role="alert">{action.error.message}</p>}

      {a.status === 'DONE' && <PaymentBox key={`${a.id}-${a.version}`} appointment={a} me={me} />}

      <a className="btn" href={`/?appointment=${a.id}`} target="_blank" rel="noopener">Открыть в приложении</a>
      <p className="hint small">Перенос, услуга и материалы — пока в приложении; медкарта — в «Пациентах».</p>
    </aside>
  )
}
