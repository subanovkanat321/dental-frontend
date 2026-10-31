import { useState } from 'react'

import type { Schemas } from '../api/client'
import { useClose } from '../lib/useClose'
import { dayTitle, formatPhone, somText, timeOf, todayIn, ZONE } from '../lib/time'
import { CommentEdit, Remind, Reschedule, ServiceEdit, Supplies, VisitNote } from './AppointmentExtras'
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
  useClose(onClose)

  const action = useAppointmentAction(a)
  // Какая форма открыта внутри карточки: одна за раз, чтобы карточка не превращалась в анкету
  const [editing, setEditing] = useState<'move' | 'service' | 'comment' | null>(null)
  const close = () => setEditing(null)
  const active = a.status === 'REQUESTED' || a.status === 'SCHEDULED'
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
      {editing === 'service' ? <ServiceEdit appointment={a} onDone={close} /> : (
        <p className="line-edit">
          <span><span className="hint">Услуга:</span> {a.serviceName ?? '—'}</span>
          {a.status !== 'CANCELLED' && <button type="button" className="link" onClick={() => setEditing('service')}>изменить</button>}
        </p>
      )}
      {editing === 'comment' ? <CommentEdit appointment={a} onDone={close} /> : a.comment ? (
        <p className="comment line-edit"><span>{a.comment}</span>
          <button type="button" className="link" onClick={() => setEditing('comment')}>изменить</button></p>
      ) : a.status !== 'CANCELLED' && (
        <button type="button" className="link" onClick={() => setEditing('comment')}>＋ Комментарий</button>
      )}
      {a.depositStatus && a.paidSom == null && <p className="hint">Предоплата {somText(a.depositSom ?? 0)}</p>}

      {a.status === 'REQUESTED' && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('SCHEDULED')}>Подтвердить</button>
          <button type="button" className="btn" disabled={action.isPending}
            onClick={() => setStatus('CANCELLED', 'Отклонить заявку? Пациенту придёт сообщение.')}>Отклонить</button>
        </div>
      )}
      {a.status === 'SCHEDULED' && <Remind appointment={a} />}
      {a.status === 'SCHEDULED' && (
        <div className="actions">
          {started && <button type="button" className="btn primary" disabled={action.isPending} onClick={() => setStatus('DONE')}>Приём состоялся</button>}
          {started && <button type="button" className="btn" disabled={action.isPending} onClick={() => setStatus('NO_SHOW')}>Неявка</button>}
          <button type="button" className="btn danger" disabled={action.isPending}
            onClick={() => setStatus('CANCELLED', `Отменить запись ${a.patient?.fullName ?? ''}? Время освободится.`)}>Отменить запись</button>
        </div>
      )}
      {active && editing !== 'move' && (
        <button type="button" className="btn" onClick={() => setEditing('move')}>
          {(me.doctors ?? []).filter((d) => d.active !== false).length > 1 ? 'Перенести или передать врачу' : 'Перенести'}
        </button>
      )}
      {editing === 'move' && <Reschedule appointment={a} me={me} onDone={close} />}
      {action.error && <p className="error" role="alert">{action.error.message}</p>}

      {a.status === 'DONE' && <PaymentBox key={`${a.id}-${a.version}`} appointment={a} me={me} />}
      {/* Материалы — у приёма, который идёт или был (как в приложении) */}
      {(a.status === 'DONE' || (a.status === 'SCHEDULED' && started)) && <Supplies appointment={a} />}
      {/* Заметка — к приёму, который идёт или был (как в приложении) */}
      {(a.status === 'DONE' || a.status === 'NO_SHOW' || (a.status === 'SCHEDULED' && started)) && <VisitNote appointment={a} />}

      <a className="btn ghost small" href={`/?appointment=${a.id}`} target="_blank" rel="noopener">Открыть в приложении</a>
    </aside>
  )
}
