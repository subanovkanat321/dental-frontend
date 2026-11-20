import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlertPill } from '../medical/Anamnesis'
import { debtLine } from '../lib/debt'
import { dateOf, shortDate, somText, todayIn } from '../lib/time'
import { activeUpcoming, usePatientCard } from './patientCard'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/**
 * Что знать о выбранном пациенте до «Записать» — под его именем в «Новой записи» (UX-аудит 2026-11-20, раздел 3):
 * уже записан (на этот же день — предупреждением: не записать дважды), долг, ⚠ аллергия пилюлей (как в карточке
 * приёма — только тому, кто видит анкету), когда был в последний раз. Данные — те же, что в карточке пациента
 * (`['patient-card', id]`, долги, анкета): долг показываем, если его отдал сервер, — как в карточке пациента.
 */
export function BookingContext({ patientId, me, date, onOpenAppointment }: {
  patientId: number
  me: Me
  /** День в форме: запись на этот же день — предупреждение. */
  date: string
  onOpenAppointment?: (a: Appointment) => void
}) {
  const card = usePatientCard(patientId)
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
    retry: false,
  })
  // Анкету сервер отдаёт врачу и руководителю — как плашка в карточке пациента
  const anamnesis = useAnamnesis(patientId, Boolean(me.admin || me.doctorId != null))
  if (!card.data) return null
  const doctorName = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName
  const many = (me.doctors ?? []).length > 1
  const upcoming = activeUpcoming(card.data)
  const debt = (debts.data ?? []).filter((d) => debtLine(d)).reduce((sum, d) => sum + d.debtSom, 0)
  const last = (card.data.past ?? []).find((a) => a.status === 'DONE')
  const who = (a: Appointment) => (many && doctorName(a.doctorId) ? ` · ${doctorName(a.doctorId)}` : '')
  return (
    <div className="booking-context" aria-label="О пациенте">
      {upcoming.slice(0, 2).map((a) => {
        const sameDay = dateOf(a.startAt) === date
        return (
          <p key={a.id} className={sameDay ? 'booking-already tone-wait' : 'booking-already'} role={sameDay ? 'alert' : undefined}>
            <span aria-hidden="true">📅 </span>
            {sameDay ? 'Уже записан на этот день: ' : 'Уже записан: '}
            <span className="num">{shortDate(a.startAt, true)}</span>{who(a)}
            {onOpenAppointment && <> <button type="button" className="link small" onClick={() => onOpenAppointment(a)}>Открыть ›</button></>}
          </p>
        )
      })}
      {debt > 0 && <p className="tone-bad num"><span aria-hidden="true">🧾 </span>Долг {somText(debt)}</p>}
      <MedAlertPill an={anamnesis.data} />
      {last
        ? <p className="hint small">Был <span className="num">{shortDate(last.startAt).replace(` ${todayIn().slice(0, 4)}`, '')}</span>{who(last)}</p>
        : upcoming.length === 0 && <p className="hint small">Ещё не был в клинике</p>}
    </div>
  )
}
