import type { Schemas } from '../../api/client'
import { addDays, dateOf, minutesOfTime, monthRange, weekStart } from '../../lib/time'
import { statusOf } from '../status'
import { durationOf } from '../week/weekModel'

type Appointment = Schemas['AppointmentView']
type Hours = Schemas['DoctorHoursView']
type TimeOff = Schemas['TimeOffView']
type Weekday = NonNullable<Schemas['DoctorHoursViewDay']['weekday']>

const WEEKDAYS: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

/** Статусы, которые показываем точками в ячейке месяца — в порядке «что важнее»; отменённые не считаем. */
export const MONTH_KINDS = ['request', 'wait', 'ok', 'cashier', 'done', 'bad', 'quiet'] as const
export type MonthKind = (typeof MONTH_KINDS)[number]

/** 'YYYY-MM-DD' → 'MONDAY'… (день недели по календарю, без часового пояса). */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!
}

/**
 * Дни сетки месяца: с понедельника недели 1-го числа до воскресенья недели последнего — 5 или 6
 * недель по 7 дней. Дни соседних месяцев тоже в сетке (приглушённые), как в бумажном календаре.
 */
export function monthGridDays(month: string): string[] {
  const { from, to } = monthRange(month)
  const start = weekStart(from)
  const end = addDays(weekStart(to), 6)
  const days: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

/** Сколько дней в месяце — столько дней и просим у /api/appointments/range (он отдаёт до 31). */
export function daysInMonth(month: string): number {
  return Number(monthRange(month).to.slice(8, 10))
}

/** «Ноябрь 2026». */
export function monthTitle(month: string): string {
  const text = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`))
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/\s*г\.?$/, '')
}

/** '2026-11' ± n месяцев. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** Рабочее время врача в этот день по недельному графику и перерывам/выходным (/api/time-off). */
export type WorkDay = { off: boolean; offTitle?: string; minutes: number }

/**
 * Работает ли врач в этот день и сколько минут. Недельный график — /api/doctors/{id}/hours (без своего
 * графика сервер отдаёт часы клиники); выходной на весь день (каждую неделю или разово, у врача или у
 * всей клиники) — нерабочий день; перерыв со временем вычитается из рабочих минут. Это та же логика,
 * что у /api/slots на сервере, только на месяц сразу и без запроса на каждый день.
 */
export function workDayOf(date: string, doctorId: number, hours: Hours | undefined, timeOff: TimeOff[]): WorkDay | null {
  if (!hours) return null
  const weekday = weekdayOf(date)
  const day = (hours.days ?? []).find((d) => d.weekday === weekday)
  const mine = timeOff.filter((t) => (t.doctorId == null || t.doctorId === doctorId)
    && (t.weekday ? t.weekday === weekday : t.firstDay != null && t.firstDay <= date && date <= (t.lastDay ?? t.firstDay)))
  const whole = mine.find((t) => !t.startTime)
  if (whole) return { off: true, offTitle: `${whole.emoji ?? ''} ${whole.title ?? ''}`.trim() || 'Выходной', minutes: 0 }
  if (!day?.start || !day.end) return { off: true, minutes: 0 }
  const start = minutesOfTime(day.start)
  const end = minutesOfTime(day.end)
  let minutes = Math.max(end - start, 0)
  for (const t of mine) {
    const from = Math.max(minutesOfTime(t.startTime!), start)
    const to = Math.min(minutesOfTime(t.endTime ?? t.startTime!), end)
    if (to > from) minutes -= to - from
  }
  return { off: false, minutes: Math.max(minutes, 0) }
}

/** Итог дня в ячейке месяца: сколько записей, сколько каждого статуса, загрузка от рабочего времени. */
export type DayStat = {
  count: number
  kinds: Partial<Record<MonthKind, number>>
  /** Занятые минуты / рабочие минуты, 0…1; null — рабочее время ещё не загружено. */
  load: number | null
  /** У всех выбранных врачей нерабочий день. */
  off: boolean
  offTitle?: string
}

/**
 * Итоги по дням месяца для одного или нескольких врачей: записи — сумма по врачам, загрузка — все
 * занятые минуты от всего рабочего времени выбранных врачей; день нерабочий, только если не работает
 * никто. Приём в выходной (записали вне графика) — загрузка 100%, а не деление на ноль.
 */
export function monthStats(days: string[], doctors: { id: number; hours?: Hours }[], appointments: Appointment[],
  timeOff: TimeOff[], now = new Date()): Map<string, DayStat> {
  const byDay = new Map<string, Appointment[]>()
  for (const a of appointments) {
    if (a.status === 'CANCELLED' || !a.startAt) continue
    const d = dateOf(a.startAt)
    byDay.set(d, [...(byDay.get(d) ?? []), a])
  }
  const result = new Map<string, DayStat>()
  for (const date of days) {
    const list = byDay.get(date) ?? []
    const kinds: Partial<Record<MonthKind, number>> = {}
    for (const a of list) {
      const k = statusOf(a, now).kind
      kinds[k] = (kinds[k] ?? 0) + 1
    }
    const work = doctors.map((d) => workDayOf(date, d.id, d.hours, timeOff))
    const known = work.every((w) => w != null)
    const off = known && work.length > 0 && work.every((w) => w!.off)
    const workMinutes = work.reduce((sum, w) => sum + (w?.minutes ?? 0), 0)
    const busy = list.reduce((sum, a) => sum + durationOf(a), 0)
    const load = !known ? null : workMinutes > 0 ? Math.min(busy / workMinutes, 1) : busy > 0 ? 1 : 0
    // Подпись выходного («🎉 Праздник») — если она у всех выбранных врачей одна (выходной клиники)
    const titles = new Set(work.map((w) => w?.offTitle))
    const offTitle = off && titles.size === 1 ? work[0]!.offTitle : undefined
    result.set(date, { count: list.length, kinds, load, off, offTitle })
  }
  return result
}

/** «3 записи», «1 запись», «5 записей». */
export function recordsText(n: number): string {
  const tail = n % 10 === 1 && n % 100 !== 11 ? 'запись' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'записи' : 'записей'
  return `${n} ${tail}`
}
