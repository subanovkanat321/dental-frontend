import type { Schemas } from '../api/client'
import { dateOf, dayMinutes, minutesOfTime, shiftText } from '../lib/time'

type Slots = Schemas['SlotsView']
type Appointment = Schemas['AppointmentView']

/** Отрезок дня в минутах от полуночи: [начало, конец), конец до 1440. */
export type Span = [number, number]

/**
 * Рабочие отрезки врача в день {@code date} (минуты от полуночи по Бишкеку). Сервер отдаёт их в
 * {@code work}: у дневного врача один (09:00–18:00), у ночного — хвост вчерашней смены и начало
 * сегодняшней (00:00–08:00 и 18:00–24:00). Старый ответ без {@code work} — по workStart/workEnd.
 */
export function workSpans(sl: Slots | undefined, date: string): Span[] {
  if (!sl?.workingDay) return []
  if (sl.work?.length) return sl.work.map((w) => [dayMinutes(w.start, date), dayMinutes(w.end, date)] as Span).filter(([s, e]) => e > s)
  if (!sl.workStart || !sl.workEnd) return []
  const start = minutesOfTime(sl.workStart)
  const end = minutesOfTime(sl.workEnd)
  return [[start, end > start ? end : 24 * 60]]
}

/** Нерабочие куски сетки [from, to) между рабочими отрезками — их закрашиваем серым. */
export function offSpans(work: Span[], from: number, to: number): Span[] {
  const result: Span[] = []
  let cursor = from
  for (const [s, e] of [...work].sort((a, b) => a[0] - b[0])) {
    if (s > cursor) result.push([cursor, Math.min(s, to)])
    cursor = Math.max(cursor, e)
  }
  if (cursor < to) result.push([cursor, to])
  return result.filter(([s, e]) => e > s)
}

/**
 * Часы под именем врача: «09:00–18:00», ночная смена — «18:00–08:00 (ночь)». День только с утром
 * вчерашней ночной смены сервер отдаёт как 00:00–её конец.
 */
export function slotsHoursText(sl: Slots | undefined): string {
  if (!sl) return ''
  if (!sl.workingDay || !sl.workStart || !sl.workEnd) return 'выходной'
  return shiftText(sl.workStart, sl.workEnd)
}

/** Минут в сутках. */
export const DAY = 24 * 60

/**
 * На сколько сетка дня продлевается после полуночи ради приёма, который начался вечером и идёт в
 * завтра (23:45–00:45 — виден целиком в своём дне, а не полоской до 24:00). Больше 4 часов — обрезка.
 */
export const AFTER_MIDNIGHT = 4 * 60

/** Минуты момента от полуночи дня {@code date} по Бишкеку — без обрезки (вчера — меньше 0, завтра — больше 1440). */
export function rawMinutes(instant: string, date: string): number {
  return Math.round((new Date(instant).getTime() - new Date(`${date}T00:00:00+06:00`).getTime()) / 60_000)
}

/**
 * Границы сетки «Дня» или «Недели» по целым часам. {@code from}/{@code to} — минуты от полуночи
 * дня колонки, {@code to} может быть больше 1440: приём 23:45–00:45 продлевает сетку до 01:00 (часы
 * после полуночи — уже завтра). {@code limit} — докуда в колонке видно приём, начатый в её день.
 * <p>
 * Не продлеваем, когда сетка и так с 00:00 (ночная смена, приём «со вчера»): сутки целиком, иначе
 * одни и те же часы были бы видны дважды. Тогда приём обрезан полуночью, а в следующем дне виден
 * «со вчера». В «Неделе» продолжение приёма в соседнем дне тогда не рисуем — он целиком в своём.
 *
 * @param work рабочие отрезки всех колонок (workSpans), пусто — часы клиники {@code fallback}
 * @param appointments приёмы колонок без отменённых, в том числе вчерашние через полночь
 * @param days дни колонок по порядку: «День» — один, «Неделя» — семь
 */
export function gridRange(work: Span[], appointments: Appointment[], days: string[], fallback: Span): { from: number; to: number; limit: number } {
  const first = days[0]!
  const last = days[days.length - 1]!
  const own = appointments.filter((a) => a.startAt && a.endAt && dateOf(a.startAt) >= first && dateOf(a.startAt) <= last)
  // Начался до первой колонки, а виден в ней (вчерашний приём в «Дне», воскресный в понедельнике недели)
  let carried = appointments.some((a) => a.startAt && a.endAt && dateOf(a.startAt) < first && touchesDay(a, first))
  const starts = [...work.map(([s]) => s), ...own.map((a) => rawMinutes(a.startAt, dateOf(a.startAt)))]
  let from = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : fallback[0]
  if (!work.length) from = Math.min(from, fallback[0])
  let limit = Math.min(DAY + AFTER_MIDNIGHT, from + DAY)
  // Хвост длиннее продления, а следующий день — тоже колонка («Неделя»): там его и покажем, «со вчера»
  if (own.some((a) => dateOf(a.startAt) < last && rawMinutes(a.endAt, dateOf(a.startAt)) > limit)) carried = true
  if (carried) {
    from = 0
    limit = DAY
  }
  const ends = [...work.map(([, e]) => e), ...own.map((a) => Math.min(rawMinutes(a.endAt, dateOf(a.startAt)), limit))]
  let to = work.length ? Math.max(...work.map(([, e]) => e)) : fallback[1]
  if (ends.length) to = Math.max(to, ...ends)
  to = Math.min(Math.ceil(to / 60) * 60, limit === DAY ? DAY : DAY + AFTER_MIDNIGHT)
  return { from, to: Math.max(to, from + 60), limit }
}

/** Приём задевает день {@code date}: начался в нём или идёт в него из прошлого дня через полночь. */
export function touchesDay(a: Appointment, date: string): boolean {
  return Boolean(a.startAt && a.endAt) && dayMinutes(a.startAt, date) < DAY && dayMinutes(a.endAt, date) > 0
}

/** Приём начался накануне — в сетке видна только его часть после полуночи. */
export function fromYesterday(a: Appointment, date: string): boolean {
  return Boolean(a.startAt) && dateOf(a.startAt) < date
}

/**
 * Место приёма в колонке дня: минуты начала и конца. Начало вчера — с 00:00; конец — не дальше
 * {@code limit} (1440 — полночь; больше — сетка продлена после полуночи, gridRange).
 */
export function apptSpan(a: Appointment, date: string, limit = DAY): Span {
  const clamp = (m: number) => Math.min(Math.max(m, 0), limit)
  return [clamp(rawMinutes(a.startAt, date)), clamp(rawMinutes(a.endAt, date))]
}

/** Приём идёт дальше, чем видно в колонке (полночь или край продления): блок обрезан снизу. */
export function untilTomorrow(a: Appointment, date: string, limit = DAY): boolean {
  return Boolean(a.endAt) && rawMinutes(a.endAt, date) > limit
}

/** Подпись часа сетки: после полуночи — снова 00:00, 01:00… */
export function hourLabel(minutes: number): string {
  return `${String(Math.floor((minutes % DAY) / 60)).padStart(2, '0')}:00`
}
