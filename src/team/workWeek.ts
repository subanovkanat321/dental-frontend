import type { Schemas } from '../api/client'
import { isNightShift } from '../lib/time'
import { WEEK, type Weekday } from './texts'

type TimeOff = Schemas['TimeOffView']
export type Shift = Schemas['ShiftServiceShiftView']
type WeekDay = { weekday?: string; start?: string; end?: string }

/** Часы каждого дня недели: '9–18' или null — выходной. */
export type DayHours = Record<Weekday, string | null>

/** '09:00:00' → '9', '09:30' → '9:30': коротко, как говорят в клинике («с 9 до 18»). */
export function shortTime(time?: string): string {
  const [h = '0', m = '00'] = (time ?? '').split(':')
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`
}

/** «9–18»; ночная смена врача (конец раньше начала) — «18–8 🌙». */
export function shortHours(start?: string, end?: string): string {
  return `${shortTime(start)}–${shortTime(end)}${isNightShift(start, end) ? ' 🌙' : ''}`
}

/**
 * Неделя по дням: рабочие дни из графика (врача — doctor_hours или часы клиники, сотрудника — staff_hours
 * или часы клиники), минус дни, закрытые еженедельным выходным («Перерывы и выходные»).
 */
export function dayHours(days: WeekDay[] | undefined, off: Partial<Record<Weekday, unknown>> = {}): DayHours {
  const byDay = new Map((days ?? []).map((d) => [d.weekday, d]))
  return Object.fromEntries(WEEK.map(([code]) => {
    const d = byDay.get(code)
    return [code, d && !off[code] ? shortHours(d.start, d.end) : null]
  })) as DayHours
}

/**
 * «Пн–Пт 9–18, Сб 10–14» — неделя одной строкой: подряд идущие дни с одинаковыми часами — вместе.
 * Ни одного рабочего дня — «не работает».
 */
export function weekSummary(hours: DayHours): string {
  const parts: string[] = []
  let i = 0
  while (i < WEEK.length) {
    const text = hours[WEEK[i]![0]]
    if (!text) { i++; continue }
    let j = i
    while (j + 1 < WEEK.length && hours[WEEK[j + 1]![0]] === text) j++
    const days = j === i ? WEEK[i]![2] : `${WEEK[i]![2]}–${WEEK[j]![2]}`
    parts.push(`${days} ${text}`)
    i = j + 1
  }
  return parts.length ? parts.join(', ') : 'не работает'
}

/**
 * Перерывы и выходные врача на эту дату (не еженедельные): свои и всей клиники — отпуск, праздник,
 * «ушёл в 15:00». Еженедельные (обед, «каждое воскресенье») — в недельном графике, не здесь.
 */
export function offOnDate(list: TimeOff[] | undefined, doctorId: number, date: string): TimeOff[] {
  return (list ?? []).filter((t) => !t.weekday && t.firstDay && t.firstDay <= date && (t.lastDay ?? t.firstDay) >= date
    && (t.doctorId == null || t.doctorId === doctorId))
}

/** Роль в строке графика — коротко, как в «Персонале». */
export const SHIFT_ROLE: Record<string, string> = { ADMIN: 'руководитель', RECEPTION: 'регистратура', ASSISTANT: 'ассистент' }

/** '09:00:00' → '09:00'. */
export const hm = (time?: string) => (time ?? '').slice(0, 5)

/** «09:00–15:00». */
export const shiftHours = (s: Shift) => `${hm(s.startTime)}–${hm(s.endTime)}`

/** «Понедельник, 2 июня» — подпись дня в кнопках ячеек. */
export const dayLong = (date: string) => {
  const text = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T00:00:00Z`))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Чья неделя: врач (doctor_hours, GET/PUT /api/doctors/{id}/hours) или сотрудник без кресла — регистратура,
 * ассистент, руководитель (staff_hours, GET/PUT /api/shifts/weekly/{telegramId}).
 */
export type Who = { kind: 'doctor'; id: number; name: string } | { kind: 'staff'; telegramId: number; name: string }

/** Ключ кеша недели — тот же, что у списка «Графика» (он показывает её строкой). */
export const weekKey = (who: Who) => (who.kind === 'doctor' ? ['doctor-hours', who.id] : ['staff-weekly', who.telegramId])
