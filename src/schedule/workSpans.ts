import type { Schemas } from '../api/client'
import { addDays, dateOf, dayMinutes, minutesOfTime, shiftText } from '../lib/time'

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
  if (sl.work?.length) return sl.work.map((w) => [dayMinutes(w.start!, date), dayMinutes(w.end!, date)] as Span).filter(([s, e]) => e > s)
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

/** Приём задевает день {@code date}: начался в нём или идёт в него из прошлого дня через полночь. */
export function touchesDay(a: Appointment, date: string): boolean {
  return Boolean(a.startAt && a.endAt) && dayMinutes(a.startAt!, date) < 24 * 60 && dayMinutes(a.endAt!, date) > 0
}

/** Приём начался накануне — в сетке видна только его часть после полуночи. */
export function fromYesterday(a: Appointment, date: string): boolean {
  return Boolean(a.startAt) && dateOf(a.startAt!) < date
}

/** Место приёма в сетке дня: минуты начала и конца, обрезанные полуночью. */
export function apptSpan(a: Appointment, date: string): Span {
  return [dayMinutes(a.startAt!, date), dayMinutes(a.endAt!, date)]
}

/** Приём идёт дальше полуночи — в сетке этого дня виден только до 24:00. */
export function untilTomorrow(a: Appointment, date: string): boolean {
  return Boolean(a.endAt) && new Date(a.endAt!) > new Date(`${addDays(date, 1)}T00:00:00+06:00`)
}
