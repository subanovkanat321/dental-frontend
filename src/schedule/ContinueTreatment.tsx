import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { Fold } from '../layout/Fold'
import { shortDate } from '../lib/time'
import { visitToothText } from '../medical/toothStates'

type Appointment = Schemas['AppointmentView']

/** Сколько этапов плана показать в карточке: остальное — в медкарте. */
const STEPS = 4

/**
 * «Продолжение лечения»: пациент пришёл снова — в карточке приёма сразу видно, что сделали в
 * прошлый раз (заметка о визите) и что осталось по плану лечения. Медданные: только тому, кто
 * видит медкарту (врач приёма, его ассистент, админ) — сервер другим и не отдаст.
 *
 * Строка-раскрывашка «Продолжение лечения · осталось по плану: 3»: открыта сама, когда пациент уже
 * в кресле (open), иначе — по нажатию.
 *
 * Остальные прошлые визиты — ссылкой «Прошлые визиты: ещё 2 ›» внутри блока (раньше — отдельной раскрывашкой под
 * заметкой: третий повтор одного и того же, UX-аудит 2026-11-20); остаток плана целиком — в строке «План лечения».
 *
 * Запросы — с теми же ключами, что у медкарты (['notes', id], ['plan', id]): сохранили заметку
 * или отметили этап — блок обновится сам.
 */
export function ContinueTreatment({ appointment: a, onMedical, open = false }: { appointment: Appointment; onMedical?: () => void; open?: boolean }) {
  const [pastOpen, setPastOpen] = useState(false)
  const patientId = a.patient.id
  const enabled = patientId != null && a.status !== 'CANCELLED'
  const notes = useQuery({
    queryKey: ['notes', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/notes', { params: { path: { patientId: patientId } } })),
    enabled,
    retry: false,
  })
  const plan = useQuery({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId: patientId } } })),
    enabled,
    retry: false,
  })
  // Зубы прошлого визита («Зубы этого приёма») — тот же ключ, что у истории в медкарте
  const history = useQuery({
    queryKey: ['teeth-history', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth/history', { params: { path: { patientId: patientId } } })),
    enabled,
    retry: false,
  })
  if (!enabled) return null

  // Последняя заметка до этого приёма — «что сделали в прошлый раз»
  const before = a.startAt ? Date.parse(a.startAt) : Infinity
  const last = (notes.data ?? [])
    .filter((n) => n.appointmentId !== a.id && n.note?.trim() && n.startAt && Date.parse(n.startAt) < before)
    .sort((x, y) => Date.parse(y.startAt!) - Date.parse(x.startAt!))[0]
  // Другие прошлые визиты с заметкой — списком дат по «ещё N ›»
  const earlier = (notes.data ?? [])
    .filter((n) => n.appointmentId !== a.id && n.appointmentId !== last?.appointmentId && n.note?.trim() && (!n.startAt || Date.parse(n.startAt) < before))
    .sort((x, y) => Date.parse(y.startAt ?? '') - Date.parse(x.startAt ?? ''))
  const lastTeeth = (history.data ?? [])
    .filter((v) => v.appointmentId !== a.id && v.startAt && Date.parse(v.startAt) < before && v.teeth?.length)
    .sort((x, y) => Date.parse(y.startAt!) - Date.parse(x.startAt!))[0]
  const left = (plan.data ?? []).filter((s) => !s.doneAt)
  if (!last && !lastTeeth && left.length === 0) return null

  return (
    <Fold title="Продолжение лечения" defaultOpen={open}
      meta={left.length ? `по плану ещё ${left.length}` : last ? `были ${shortDate(last.startAt!)}` : undefined}>
    <div className="continue">
      {last && (
        <div>
          <span className="hint">В прошлый раз — {shortDate(last.startAt!)}{last.editable === false && last.visitDoctorName ? `, Врач: ${last.visitDoctorName}` : last.doctorName ? `, ${last.doctorName}` : ''}</span>
          <p className="continue-note">{last.note}</p>
        </div>
      )}
      {lastTeeth && (
        <div>
          <span className="hint">Зубы в прошлый раз{lastTeeth.appointmentId !== last?.appointmentId ? ` — ${shortDate(lastTeeth.startAt!)}` : ''}</span>
          <p className="continue-note">{lastTeeth.teeth!.map((t) => visitToothText(t)).join('; ')}</p>
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
          {left.length > STEPS && <span className="hint">и ещё {left.length - STEPS}</span>}
        </div>
      )}
      {earlier.length > 0 && (
        <div>
          <button type="button" className="link" aria-expanded={pastOpen} onClick={() => setPastOpen(!pastOpen)}>
            Прошлые визиты: ещё {earlier.length} {pastOpen ? '‹' : '›'}</button>
          {pastOpen && <PastVisits notes={earlier} />}
        </div>
      )}
      {onMedical && <button type="button" className="link" onClick={onMedical}>Карта зубов и план лечения ›</button>}
    </div>
    </Fold>
  )
}

/** Прошлые визиты: список дат, нажали — заметка того визита (только читать). */
function PastVisits({ notes }: { notes: Schemas['VisitNoteView'][] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <ul className="past-visits" aria-label="Прошлые визиты">
      {notes.map((n) => (
        <li key={n.appointmentId}>
          <button type="button" className="past-visit-date" aria-expanded={open === n.appointmentId}
            onClick={() => setOpen(open === n.appointmentId ? null : n.appointmentId)}>
            <span>{n.startAt ? shortDate(n.startAt) : '—'}</span>
            {n.visitDoctorName && <span className="hint small">{n.visitDoctorName}</span>}
          </button>
          {open === n.appointmentId && <p className="past-visit-note">{n.note}</p>}
        </li>
      ))}
    </ul>
  )
}
