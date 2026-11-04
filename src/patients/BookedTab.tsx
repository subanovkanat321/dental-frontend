import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { isAssistant } from '../lib/roles'
import { serviceEmoji } from '../lib/serviceEmoji'
import { dateOf, dayTitle, timeOf, todayIn } from '../lib/time'
import { statusOf } from '../schedule/status'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Период списка: дни вперёд, считая сегодня (сервер отдаёт до 31 дня одним запросом на врача). */
const PERIODS = [[7, 'Неделя'], [14, '2 недели'], [31, 'Месяц']] as const

/**
 * «Пациенты → Записаны»: все будущие записи одним списком по дням — обзвонить, увидеть, кто не
 * подтвердил, загрузку на неделю (на телефоне «Недели» нет). Те же приёмы, что в «Расписании»
 * (/api/appointments/range по каждому видимому врачу), без отменённых и прошедших. Нажали строку —
 * карточка приёма в «Расписании».
 */
export function BookedTab({ me, onOpenAppointment }: { me: Me; onOpenAppointment?: (id: number) => void }) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id!)))
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [days, setDays] = useState<number>(7)
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false)
  // «Сейчас» — на момент открытия вкладки: закончившиеся сегодня приёмы в список не идут
  const [now] = useState(() => Date.now())
  const shown = doctorId == null ? doctors : doctors.filter((d) => d.id === doctorId)
  const today = todayIn()
  const lists = useQueries({
    queries: shown.map((d) => ({
      queryKey: ['appointments', 'range', today, days, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments/range', { params: { query: { from: today, days, doctorId: d.id! } } })),
    })),
  })
  const nameOf = new Map(doctors.map((d) => [d.id, d.fullName ?? '']))
  const all = lists.flatMap((q) => q.data ?? [])
    // Будущие: заявки и запланированные, ещё не закончившиеся
    .filter((a) => (a.status === 'SCHEDULED' || a.status === 'REQUESTED') && (!a.endAt || Date.parse(a.endAt) >= now))
    .filter((a) => !onlyUnconfirmed || (a.status === 'REQUESTED' || a.reply !== 'CONFIRMED'))
    .sort((x, y) => Date.parse(x.startAt!) - Date.parse(y.startAt!))
  const byDay = new Map<string, Appointment[]>()
  for (const a of all) {
    const day = dateOf(a.startAt!)
    byDay.set(day, [...(byDay.get(day) ?? []), a])
  }
  const pending = lists.some((q) => q.isPending)
  const failed = lists.find((q) => q.error)?.error

  return (
    <section className="booked" aria-label="Записанные пациенты">
      <div className="booked-filters">
        <div className="segments" role="group" aria-label="Период">
          {PERIODS.map(([d, title]) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{title}</button>
          ))}
        </div>
        {doctors.length > 1 && (
          <Select aria-label="Врач" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Все врачи</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</option>)}
          </Select>
        )}
        <label className="check">
          <input type="checkbox" checked={onlyUnconfirmed} onChange={(e) => setOnlyUnconfirmed(e.target.checked)} />
          Только кто не подтвердил
        </label>
      </div>
      {failed && <p className="error">{failed.message}</p>}
      {pending ? <p className="hint">Загрузка…</p> : !all.length ? (
        <EmptyState icon="📅" title={onlyUnconfirmed ? 'Все записанные подтвердили приход.' : 'Записей на этот период нет.'} />
      ) : (
        <>
          <p className="hint small">Записей: {all.length}</p>
          {[...byDay].map(([day, list]) => (
            <div key={day} className="booked-day">
              <h3>{day === today ? `Сегодня, ${dayTitle(day).toLowerCase()}` : dayTitle(day)} <span className="hint">· {list.length}</span></h3>
              <ul aria-label={dayTitle(day)}>
                {list.map((a) => {
                  const s = statusOf(a)
                  return (
                    <li key={a.id}>
                      <button type="button" className="booked-row" onClick={() => onOpenAppointment?.(a.id!)}>
                        <span className="num booked-time">{timeOf(a.startAt!)}</span>
                        <span className="booked-main">
                          <strong>{a.patient?.fullName}</strong>
                          <span className="hint small">
                            {a.serviceName ? `${serviceEmoji(a.serviceName)} ${a.serviceName}` : 'Услуга не выбрана'}
                            {doctors.length > 1 && doctorId == null && a.doctorId != null ? ` · ${nameOf.get(a.doctorId)}` : ''}
                          </span>
                        </span>
                        <span className={`chip small s-${s.kind}`}><span aria-hidden="true">{s.icon}</span> {s.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
