import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { agoText } from '../lib/texts'
import { shortDate } from '../lib/time'
import { statusOf } from './status'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

/** Сколько прошлых визитов показать в карточке приёма: остальные — в карточке пациента. */
const SHOWN = 3

/**
 * «История пациента» в карточке приёма: впервые ли он у вас, сколько раз приходил, когда и с чем
 * был в последний раз, у какого врача, сколько раз не пришёл — даже если врач ничего не записал.
 * Без медданных (заметки, зубы, план — в «Продолжении лечения» для тех, кто видит медкарту),
 * поэтому видно и регистратуре. Те же данные и ключ, что у карточки пациента (['patient-card', id]).
 */
export function PatientHistory({ appointment: a, me, onOpenPatient }: {
  appointment: Appointment
  me: Me
  onOpenPatient?: (patientId: number) => void
}) {
  const patientId = a.patient?.id
  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId: patientId! } } })),
    enabled: patientId != null,
    retry: false,
  })
  if (patientId == null || !card.data) return null

  const before = a.startAt ? Date.parse(a.startAt) : Infinity
  const earlier = (card.data.past ?? [])
    .filter((v) => v.id !== a.id && v.startAt && Date.parse(v.startAt) < before)
    .sort((x, y) => Date.parse(y.startAt!) - Date.parse(x.startAt!))
  const visits = earlier.filter((v) => v.status === 'DONE')
  const noShows = earlier.filter((v) => v.status === 'NO_SHOW').length
  const last = visits[0]
  const doctors = me.doctors ?? []
  const doctorName = (id?: number) => doctors.find((d) => d.id === id)?.fullName
  const many = doctors.length > 1

  return (
    <section className="patient-history" aria-label="История пациента">
      <h3>История пациента</h3>
      {!last ? (
        <p className="history-line"><span aria-hidden="true">🆕</span> Впервые в клинике</p>
      ) : (
        <p className="history-line">
          Визитов: <b className="num">{visits.length}</b> · последний — <b>{shortDate(last.startAt!)}</b>
          <span className="hint"> ({agoText(last.startAt!)})</span>
          {last.serviceName && <>, {last.serviceName}</>}
          {many && doctorName(last.doctorId) && <span className="hint"> · {doctorName(last.doctorId)}</span>}
        </p>
      )}
      {noShows > 0 && (
        <p className="history-line tone-wait"><span aria-hidden="true">⚠️</span> Не пришёл без предупреждения: <b className="num">{noShows}</b> {timesWord(noShows)} — лучше напомнить</p>
      )}
      {earlier.length > 0 && (
        <ul className="history-visits">
          {earlier.slice(0, SHOWN).map((v) => {
            const s = statusOf(v)
            return (
              <li key={v.id}>
                <span className="num nowrap">{shortDate(v.startAt!)}</span>
                {' '}<span className={`chip small s-${s.kind}`}><span className="ico" aria-hidden="true">{s.icon}</span>{s.label}</span>
                {v.serviceName && <span className="hint"> · {v.serviceName}</span>}
                {many && doctorName(v.doctorId) && <span className="hint"> · {doctorName(v.doctorId)}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {onOpenPatient && earlier.length > 0 && (
        <button type="button" className="link" onClick={() => onOpenPatient(patientId)}>
          {earlier.length > SHOWN ? `Вся история (${earlier.length}) ›` : 'Карточка пациента ›'}
        </button>
      )}
    </section>
  )
}

function timesWord(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  return mod100 >= 12 && mod100 <= 14 ? 'раз' : mod10 >= 2 && mod10 <= 4 ? 'раза' : 'раз'
}
