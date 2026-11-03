import type { Schemas } from '../../api/client'
import { canEditDoctor } from '../../lib/roles'
import { addDays, minutesOf, minutesOfTime } from '../../lib/time'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Slots = Schemas['SlotsView']

/** Шаг перетаскивания и записи по пустому месту — 15 минут, как в сетке «Дня». */
export const SNAP = 15

/** Семь дней недели с понедельника 'YYYY-MM-DD'. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Длительность приёма в минутах (приём до полуночи — тоже верно). */
export function durationOf(a: Appointment): number {
  return (minutesOf(a.endAt!) - minutesOf(a.startAt!) + 24 * 60) % (24 * 60) || 30
}

/**
 * Можно ли перетащить приём: только тот, что ещё впереди, запланирован или заявка, и только в
 * расписании, которое мне можно менять (тот же список, что Staff.requireCanEdit на сервере).
 * Прошедший, состоявшийся, неявка — нет: их время — уже история.
 */
export function canDrag(a: Appointment, me: Me, now = new Date()): boolean {
  return (a.status === 'SCHEDULED' || a.status === 'REQUESTED') && canEditDoctor(me, a.doctorId)
    && a.startAt != null && new Date(a.startAt) > now
}

/**
 * Часы сетки недели: от раннего начала до позднего конца рабочих дней (по целым часам); пока часы
 * не загружены или вся неделя выходная — часы клиники. Приём вне часов растягивает сетку до себя.
 */
export function weekHours(slots: (Slots | undefined)[], appointments: Appointment[], clinic: { workStart?: string; workEnd?: string } | undefined) {
  const working = slots.filter((s): s is Slots => Boolean(s?.workingDay && s.workStart && s.workEnd))
  let from = working.length ? Math.min(...working.map((s) => Math.floor(minutesOfTime(s.workStart!) / 60) * 60))
    : minutesOfTime(clinic?.workStart ?? '09:00')
  let to = working.length ? Math.max(...working.map((s) => Math.ceil(minutesOfTime(s.workEnd!) / 60) * 60))
    : minutesOfTime(clinic?.workEnd ?? '18:00')
  for (const a of appointments) {
    if (a.status === 'CANCELLED') continue
    from = Math.min(from, Math.floor(minutesOf(a.startAt!) / 60) * 60)
    to = Math.max(to, Math.ceil(minutesOf(a.endAt!) / 60) * 60 || 24 * 60)
  }
  return { from, to }
}

/** Минуты от полуночи → вниз к шагу 15 минут и внутрь сетки, чтобы приём длиной {@code duration} поместился. */
export function snapInto(minutes: number, duration: number, from: number, to: number): number {
  const snapped = Math.round(minutes / SNAP) * SNAP
  return Math.min(Math.max(snapped, from), Math.max(from, to - duration))
}

/** «Пн, 2» — короткая подпись дня недели. */
export function dayLabel(date: string): { weekday: string; day: number } {
  const weekday = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T00:00:00Z`))
  return { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), day: Number(date.slice(8, 10)) }
}
