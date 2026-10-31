import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { formatPhone, shortDate, somText } from '../lib/time'
import { statusOf } from '../schedule/status'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Appointment = Schemas['AppointmentView']

/** Сколько прошлых визитов показать сразу: остальное — в приложении. */
const PAST = 10

/**
 * Карточка пациента справа: контакты, сколько раз был / не пришёл, ближайшие записи, история,
 * долги. «Записать» — «Новая запись» в «Расписании» на него. Медкарта и снимки — пока в
 * приложении (?patientCard=ID): их перенесём следующими.
 */
export function PatientPanel({ patientId, me, onClose, onBook }: {
  patientId: number
  me: Me
  onClose: () => void
  onBook: (p: Patient) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const card = useQuery({
    queryKey: ['patient-card', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/by-patient/{patientId}', { params: { path: { patientId } } })),
  })
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
  })

  const doctorName = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName
  const many = (me.doctors ?? []).length > 1
  const line = (a: Appointment) => {
    const s = statusOf(a)
    return (
      <li key={a.id}>
        <span className="nowrap">{shortDate(a.startAt!, true)}</span>
        <span className={`tone-${s.tone}`}> {s.icon} {s.label}</span>
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
        {patient?.telegram ? '✈️ Пишет боту — напоминания в Telegram' : 'Без бота — напоминание в WhatsApp'}
        {patient?.birthDate ? ` · родился ${shortDate(`${patient.birthDate}T12:00:00Z`)}` : ''}
        {patient?.workplace ? ` · ${patient.workplace}` : ''}
      </p>
      <p className="stats">
        <span className="tone-ok">✅ Был: {done ?? 0}</span>
        <span className={noShow ? 'tone-bad' : 'hint'}>🚷 Не пришёл: {noShow ?? 0}</span>
      </p>
      {owed > 0 && <p className="tone-wait">💳 Долг: {somText(owed)}</p>}

      <button type="button" className="btn primary" onClick={() => patient && onBook(patient)}>＋ Записать</button>

      <section>
        <h3>Записан</h3>
        {upcoming.length ? <ul className="visits">{upcoming.map(line)}</ul> : <p className="hint">Нет будущих записей</p>}
      </section>
      <section>
        <h3>История</h3>
        {past.length ? <ul className="visits">{past.slice(0, PAST).map(line)}</ul> : <p className="hint">Визитов ещё не было</p>}
        {past.length > PAST && <p className="hint small">И ещё {past.length - PAST} — в приложении</p>}
      </section>

      <a className="btn" href={`/?patientCard=${patientId}`} target="_blank" rel="noopener">Медкарта и снимки — в приложении</a>
    </aside>
  )
}
