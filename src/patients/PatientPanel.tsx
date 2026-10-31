import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { useAnamnesis } from '../api/anamnesis'
import { MedAlerts } from '../medical/Anamnesis'
import { useClose } from '../lib/useClose'
import { formatPhone, shortDate, somText } from '../lib/time'
import { statusOf } from '../schedule/status'
import { WaitlistBox } from './WaitlistTab'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

/** Сколько прошлых визитов показать сразу: остальное — в приложении. */
const PAST = 10

/**
 * Карточка пациента справа: контакты, сколько раз был / не пришёл, ближайшие записи, история,
 * долги. «Записать» — «Новая запись» в «Расписании» на него; «Медкарта» — карта зубов, план,
 * заметки и снимки во всю ширину.
 */
export function PatientPanel({ patientId, me, onClose, onBook, onMedical }: {
  patientId: number
  me: Me
  onClose: () => void
  onBook: (p: Patient) => void
  onMedical: (p: Patient) => void
}) {
  useClose(onClose)

  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId } } })),
  })
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
  })

  // Плашка из анкеты — только тем, кто видит медкарту (врач и админ); регистратуре сервер не отдаст
  const anamnesis = useAnamnesis(patientId, Boolean(me.admin || me.doctorId != null))
  const doctorName = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName
  const many = (me.doctors ?? []).length > 1
  const line = (a: Appointment) => {
    const s = statusOf(a)
    return (
      <li key={a.id}>
        <span className="nowrap num">{shortDate(a.startAt!, true)}</span>
        {' '}<span className={`chip small s-${s.kind}`}><span className="dot" />{s.label}</span>
        {a.serviceName && <span className="hint"> · {a.serviceName}</span>}
        {many && <span className="hint"> · {doctorName(a.doctorId)}</span>}
      </li>
    )
  }

  if (card.isPending) {
    return <aside className="panel" aria-label="Карточка пациента"><p className="hint">Загрузка…</p></aside>
  }
  if (card.error) {
    return (
      <aside className="panel" aria-label="Карточка пациента">
        <p className="error">{card.error.message}</p>
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
      </aside>
    )
  }
  const { patient, done, noShow, upcoming = [], past = [] } = card.data
  const owed = (debts.data ?? []).reduce((sum, d) => sum + (d.debtSom ?? 0), 0)

  return (
    <aside className="panel" aria-label="Карточка пациента">
      <header className="panel-head">
        <div>
          <h2>{patient?.fullName}</h2>
          {patient?.phone && <a href={`tel:+${patient.phone}`}>{formatPhone(patient.phone)}</a>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <p className="hint">
        {patient?.telegram ? 'Пишет боту — напоминания в Telegram' : 'Без бота — напоминание в WhatsApp'}
        {patient?.birthDate ? ` · родился ${shortDate(`${patient.birthDate}T12:00:00Z`)}` : ''}
        {patient?.workplace ? ` · ${patient.workplace}` : ''}
      </p>
      <p className="stats">
        <span className="chip small s-done">Был: <b className="num">{done ?? 0}</b></span>
        <span className={`chip small ${noShow ? 's-bad' : 's-quiet'}`}>Не пришёл: <b className="num">{noShow ?? 0}</b></span>
      </p>
      <MedAlerts an={anamnesis.data} />
      {owed > 0 && <span className="chip s-wait">Долг: {somText(owed)}</span>}

      <button type="button" className="btn primary" onClick={() => patient && onBook(patient)}>＋ Записать</button>
      {patient && <WaitlistBox patient={patient} me={me} />}

      <section>
        <h3>Записан</h3>
        {upcoming.length ? <ul className="visits">{upcoming.map(line)}</ul> : <p className="hint">Нет будущих записей</p>}
      </section>
      <section>
        <h3>История</h3>
        {past.length ? <ul className="visits">{past.slice(0, PAST).map(line)}</ul> : <p className="hint">Визитов ещё не было</p>}
        {past.length > PAST && <p className="hint small">И ещё {past.length - PAST} — в приложении</p>}
      </section>

      <button type="button" className="btn" onClick={() => patient && onMedical(patient)}>Медкарта и снимки</button>
    </aside>
  )
}
