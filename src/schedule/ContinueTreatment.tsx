import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'

type Appointment = Schemas['AppointmentView']

/** Сколько этапов плана показать в карточке: остальное — в медкарте. */
const STEPS = 4

/**
 * «Продолжение лечения»: пациент пришёл снова — в карточке приёма сразу видно, что сделали в
 * прошлый раз (заметка о визите) и что осталось по плану лечения. Медданные: только тому, кто
 * видит медкарту (врач приёма, его ассистент, админ) — сервер другим и не отдаст.
 *
 * Запросы — с теми же ключами, что у медкарты (['notes', id], ['plan', id]): сохранили заметку
 * или отметили этап — блок обновится сам.
 */
export function ContinueTreatment({ appointment: a, onMedical }: { appointment: Appointment; onMedical?: () => void }) {
  const patientId = a.patient?.id
  const enabled = patientId != null && a.status !== 'CANCELLED'
  const notes = useQuery({
    queryKey: ['notes', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/notes', { params: { path: { patientId: patientId! } } })),
    enabled,
    retry: false,
  })
  const plan = useQuery({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId: patientId! } } })),
    enabled,
    retry: false,
  })
  if (!enabled) return null

  // Последняя заметка до этого приёма — «что сделали в прошлый раз»
  const before = a.startAt ? Date.parse(a.startAt) : Infinity
  const last = (notes.data ?? [])
    .filter((n) => n.appointmentId !== a.id && n.note?.trim() && n.startAt && Date.parse(n.startAt) < before)
    .sort((x, y) => Date.parse(y.startAt!) - Date.parse(x.startAt!))[0]
  const left = (plan.data ?? []).filter((s) => !s.doneAt)
  if (!last && left.length === 0) return null

  return (
    <section className="continue" aria-label="Продолжение лечения">
      <h3>Продолжение лечения</h3>
      {last && (
        <div>
          <span className="hint">В прошлый раз — {shortDate(last.startAt!)}{last.doctorName ? `, ${last.doctorName}` : ''}</span>
          <p className="continue-note">{last.note}</p>
        </div>
      )}
      {left.length > 0 && (
        <div>
          <span className="hint">Осталось по плану</span>
          <ul>
            {left.slice(0, STEPS).map((s) => (
              <li key={s.id}>{s.tooth ? <span className="num">{s.tooth} — </span> : null}{s.title}</li>
            ))}
          </ul>
          {left.length > STEPS && (onMedical
            ? <button type="button" className="link" onClick={onMedical}>Ещё {left.length - STEPS} — в плане лечения ›</button>
            : <span className="hint">и ещё {left.length - STEPS}</span>)}
        </div>
      )}
    </section>
  )
}
