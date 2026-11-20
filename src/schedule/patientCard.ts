import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']
type Card = Schemas['PatientCard']

/** Будущие записи пациента (ещё не прошли и не отменены) — по времени. */
export function activeUpcoming(card: Card | undefined): Appointment[] {
  return (card?.upcoming ?? []).filter((a) => a.status === 'SCHEDULED' || a.status === 'REQUESTED')
    .sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))
}

/** Лечащий врач — врач последнего состоявшегося приёма (past — последний первым). */
export function treatingDoctorId(card: Card | undefined): number | undefined {
  return (card?.past ?? []).find((a) => a.status === 'DONE' && a.doctorId != null)?.doctorId
}

/** Карточка пациента — тот же ключ, что у «Пациентов»: открыли его карточку — здесь уже из кэша. */
export function usePatientCard(patientId: number | undefined) {
  return useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId: patientId! } } })),
    enabled: patientId != null,
  })
}
