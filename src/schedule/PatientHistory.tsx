import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { agoText } from '../lib/texts'
import { shortDate } from '../lib/time'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

/**
 * «История пациента» в карточке приёма — одной строкой: «Впервые в клинике» или «Визитов: 3 ·
 * последний 22 окт, Лечение каналов» и, если был, «не пришёл 1 раз». Список визитов — в карточке
 * пациента («Карточка пациента ›» рядом с именем). Без медданных — видно и регистратуре. Те же
 * данные и ключ, что у карточки пациента (['patient-card', id]).
 */
export function PatientHistory({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const patientId = a.patient.id
  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId: patientId } } })),
    enabled: patientId != null,
    retry: false,
  })
  if (patientId == null || !card.data) return null

  const before = a.startAt ? Date.parse(a.startAt) : Infinity
  const earlier = (card.data.past ?? [])
    .filter((v) => v.id !== a.id && v.startAt && Date.parse(v.startAt) < before)
    .sort((x, y) => Date.parse(y.startAt) - Date.parse(x.startAt))
  const visits = earlier.filter((v) => v.status === 'DONE')
  const noShows = earlier.filter((v) => v.status === 'NO_SHOW').length
  const last = visits[0]
  const doctors = me.doctors ?? []
  const lastDoctor = doctors.length > 1 ? doctors.find((d) => d.id === last?.doctorId)?.fullName : undefined

  return (
    <p className="history-line" aria-label="История пациента">
      {!last ? <>Впервые в клинике</> : (
        <>
          Визитов: <b className="num">{visits.length}</b> · последний <span className="nowrap">{shortDate(last.startAt)}</span>
          <span className="hint"> ({agoText(last.startAt)})</span>
          {last.serviceName && <>, {last.serviceName}</>}
          {lastDoctor && <span className="hint"> · {lastDoctor}</span>}
        </>
      )}
      {noShows > 0 && <span className="tone-wait"> · не пришёл <b className="num">{noShows}</b> {timesWord(noShows)}</span>}
    </p>
  )
}

function timesWord(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  return mod100 >= 12 && mod100 <= 14 ? 'раз' : mod10 >= 2 && mod10 <= 4 ? 'раза' : 'раз'
}
