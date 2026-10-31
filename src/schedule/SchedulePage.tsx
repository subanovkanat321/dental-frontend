import { useQueries } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type MouseEvent } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { addDays, dayTitle, minutesOf, minutesOfTime, timeOf, todayIn } from '../lib/time'
import { AppointmentPanel } from './AppointmentPanel'
import { NewAppointmentPanel, type Slot } from './NewAppointmentPanel'
import { statusOf } from './status'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Сколько пикселей на минуту: час — 72 px, приём на 30 минут — 36 px, хватает на две строки. */
const PX = 1.2

/** Отступ сверху и снизу сетки: подпись первого часа («09:00») не обрезается. */
const PAD = 10

/** Расписание само перечитывается раз в минуту: кто-то записал с телефона — видно без F5. */
const REFRESH_MS = 60_000

type Side = { kind: 'appointment'; id: number; fallback?: Appointment } | { kind: 'new'; slot: Slot; patient?: Schemas['PatientView'] } | null

/**
 * «Расписание»: день всех врачей колонками, как настольный календарь. Нажать на приём — карточка
 * справа с действиями; на пустое место — «Новая запись» на это время. Расписание остаётся на экране.
 */
export function SchedulePage({ me, bookPatient = null, onBookingShown }: {
  me: Me
  /** Пришли из «Пациентов» по «Записать»: сразу «Новая запись» на этого пациента. */
  bookPatient?: Schemas['PatientView'] | null
  onBookingShown?: () => void
}) {
  const today = todayIn()
  const [date, setDate] = useState(today)
  const [side, setSide] = useState<Side>(() => {
    const doctor = (me.doctors ?? []).find((d) => d.id === me.doctorId && d.active !== false)
      ?? (me.doctors ?? []).find((d) => d.active !== false)
    return bookPatient && doctor
      ? { kind: 'new', patient: bookPatient, slot: { doctorId: doctor.id!, date: today, minutes: minutesOfTime(me.clinic?.workStart ?? '09:00') } }
      : null
  })
  // Пациента для записи взяли — забыть, чтобы при следующем заходе «Расписание» открылось как обычно
  useEffect(() => {
    if (bookPatient) onBookingShown?.()
  }, [bookPatient, onBookingShown])
  const close = useCallback(() => setSide(null), [])
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)

  const days = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['appointments', date, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments', { params: { query: { date, doctorId: d.id! } } })),
      refetchInterval: REFRESH_MS,
    })),
  })

  const loaded = days.flatMap((q) => q.data ?? [])
  const all = loaded.filter((a) => a.status !== 'CANCELLED')
  // Карточка — всегда свежая версия приёма из кэша дня (после действий и автообновления)
  const selected = side?.kind === 'appointment' ? loaded.find((a) => a.id === side.id) ?? side.fallback ?? null : null
  // Сетка — часы клиники; приём раньше или позже — сетка растягивается до него
  let from = minutesOfTime(me.clinic?.workStart ?? '09:00')
  let to = minutesOfTime(me.clinic?.workEnd ?? '18:00')
  for (const a of all) {
    from = Math.min(from, Math.floor(minutesOf(a.startAt!) / 60) * 60)
    to = Math.max(to, Math.ceil(minutesOf(a.endAt!) / 60) * 60 || 24 * 60)
  }
  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from + i * 60)
  const height = (to - from) * PX + PAD * 2

  /** Пустое место в колонке врача → «Новая запись» на это время, вниз до 15 минут. */
  const pick = (doctorId: number) => (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.appt')) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top - PAD
    const minutes = Math.min(Math.max(from + Math.floor(y / PX / 15) * 15, from), to - 15)
    setSide({ kind: 'new', slot: { doctorId, date, minutes } })
  }
  const newHere = () => {
    const first = doctors.find((d) => d.id === me.doctorId) ?? doctors[0]
    if (first) setSide({ kind: 'new', slot: { doctorId: first.id!, date, minutes: minutesOfTime(me.clinic?.workStart ?? '09:00') } })
  }

  return (
    <div className={side ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        <header className="toolbar">
          <div className="day-switch">
            <button type="button" className="btn" aria-label="Предыдущий день" onClick={() => setDate(addDays(date, -1))}>‹</button>
            <button type="button" className="btn" disabled={date === today} onClick={() => setDate(today)}>Сегодня</button>
            <button type="button" className="btn" aria-label="Следующий день" onClick={() => setDate(addDays(date, 1))}>›</button>
          </div>
          <h1>{dayTitle(date)}{date === today ? ' · сегодня' : ''}</h1>
          <input type="date" aria-label="Выбрать дату" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <span className="hint">{all.length ? `Записей: ${all.length}` : 'Записей нет'}</span>
          {doctors.length > 0 && <button type="button" className="btn primary push" onClick={newHere}>＋ Новая запись</button>}
        </header>

        {doctors.length === 0 ? (
          <p className="hint">В клинике пока нет врачей — добавьте их в приложении: «Меню → Врачи».</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${doctors.length}, minmax(180px, 1fr))` }}>
            <div className="grid-corner" />
            {doctors.map((d) => (
              <div key={d.id} className="grid-head" title={d.fullName}>{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</div>
            ))}
            <div className="grid-times" style={{ height }}>
              {hours.map((m) => (
                <span key={m} style={{ top: PAD + (m - from) * PX }}>{String(Math.floor(m / 60)).padStart(2, '0')}:00</span>
              ))}
            </div>
            {doctors.map((d, i) => {
              const q = days[i]
              return (
                <div key={d.id} className="grid-col" style={{ height }} role="group" aria-label={d.fullName}
                  title="Нажмите на свободное время — новая запись" onClick={pick(d.id!)}>
                  {hours.map((m) => <div key={m} className="grid-hour" style={{ top: PAD + (m - from) * PX }} />)}
                  {q?.isPending && <div className="hint grid-loading">Загрузка…</div>}
                  {q?.error && <div className="error grid-loading">{q.error.message}</div>}
                  {(q?.data ?? []).filter((a) => a.status !== 'CANCELLED').map((a) => {
                    const s = statusOf(a)
                    const top = PAD + (minutesOf(a.startAt!) - from) * PX
                    const h = Math.max((minutesOf(a.endAt!) - minutesOf(a.startAt!)) * PX - 2, 22)
                    return (
                      <button key={a.id} type="button" className={`appt tone-${s.tone}${selected?.id === a.id ? ' active' : ''}`}
                        style={{ top, height: h }} onClick={() => setSide({ kind: 'appointment', id: a.id! })}
                        aria-label={`${timeOf(a.startAt!)}–${timeOf(a.endAt!)}, ${a.patient?.fullName}: ${s.label}`}>
                        <span className="appt-time">{timeOf(a.startAt!)}–{timeOf(a.endAt!)}</span>
                        <span className="appt-name">{a.patient?.fullName}</span>
                        {h > 40 && <span className="appt-state">{s.icon} {s.label}</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </section>
      {selected && <AppointmentPanel appointment={selected} me={me} onClose={close} />}
      {side?.kind === 'new' && (
        <NewAppointmentPanel slot={side.slot} me={me} initialPatient={side.patient} onClose={close}
          onCreated={(a) => setSide({ kind: 'appointment', id: a.id!, fallback: a })} />
      )}
    </div>
  )
}
