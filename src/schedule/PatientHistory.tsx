import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { agoText } from '../lib/texts'
import { shortDate } from '../lib/time'
import { shortName } from '../lab/text'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

/**
 * «История пациента» в карточке приёма — одной короткой строкой (UX-аудит 2026-11-20): «Впервые в клинике» или
 * «3 визита · был 5 нояб (Пломба) · 1 неявка». Год — только если не текущий, врач — только если он другой, чем у
 * этого приёма. Список визитов — в карточке пациента (имя ›). Без медданных — видно и регистратуре. Те же данные и
 * ключ, что у карточки пациента (['patient-card', id]).
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
  const lastDoctor = doctors.length > 1 && last?.doctorId !== a.doctorId ? doctors.find((d) => d.id === last?.doctorId)?.fullName : undefined

  return (
    <p className="history-line" aria-label="История пациента">
      {!last ? <>Впервые в клинике</> : (
        <>
          <b className="num">{visits.length}</b> {plural(visits.length, 'визит', 'визита', 'визитов')} · был{' '}
          <span className="nowrap" title={agoText(last.startAt)}>{dayOf(last.startAt)}</span>
          {last.serviceName && <> ({last.serviceName})</>}
          {lastDoctor && <span className="hint"> · {shortName(lastDoctor)}</span>}
        </>
      )}
      {noShows > 0 && <span className="tone-wait"> · <b className="num">{noShows}</b> {plural(noShows, 'неявка', 'неявки', 'неявок')}</span>}
    </p>
  )
}

/** «5 нояб» — без года, если он текущий; иначе «5 нояб 2025». */
function dayOf(instant: string): string {
  const full = shortDate(instant)
  const year = String(new Date().getFullYear())
  return full.endsWith(` ${year}`) ? full.slice(0, -year.length - 1) : full
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  return mod10 >= 2 && mod10 <= 4 ? few : many
}
