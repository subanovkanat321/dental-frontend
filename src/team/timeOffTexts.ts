import type { Schemas } from '../api/client'
import { WEEK, type Weekday } from './texts'

type TimeOff = Schemas['TimeOffView']

/**
 * «Перерывы и выходные» — три понятных действия вместо одной формы (жалоба владельца 2026-11-06:
 * «хочу весь день выходным, а форма просит „например Обед“»). Хранится всё так же — одна сущность
 * бэкенда `time-off`: перерыв — с временем, выходной и отпуск — весь день (без времени).
 */

/** Вид записи: тип чипом задаёт название и значок — набирать ничего не нужно. */
export type Kind = { title: string; emoji: string }

/** Свой вид («Другое»): название пишут сами, пусто — подставим запасное. */
export const OTHER = 'Другое'

export const BREAK_KINDS: Kind[] = [
  { title: 'Обед', emoji: '🍽️' }, { title: 'Намаз', emoji: '🕌' }, { title: 'Перерыв', emoji: '☕' }, { title: OTHER, emoji: '⏸️' },
]
export const DAY_OFF_KINDS: Kind[] = [{ title: 'Выходной', emoji: '⏸️' }, { title: 'Праздник', emoji: '🎉' }]
export const LEAVE_KINDS: Kind[] = [
  { title: 'Отпуск', emoji: '🏖️' }, { title: 'Больничный', emoji: '🤒' }, { title: 'Учёба', emoji: '📚' },
  { title: 'Семейные', emoji: '👨‍👩‍👧' }, { title: OTHER, emoji: '✈️' },
]

/** Название для сервера: своё, а если пусто — по типу («Другое» без текста — запасное). */
export function titleFor(kind: Kind, own: string, fallback: string): string {
  const typed = own.trim()
  if (typed) return typed.slice(0, 60)
  return kind.title === OTHER ? fallback : kind.title
}

// Значки отпусков: по ним дневная запись «по датам» — отпуск, а не праздник
const LEAVE_EMOJI = new Set(LEAVE_KINDS.map((k) => k.emoji))

export type Group = 'break' | 'dayOff' | 'leave'

/** В какой список: с временем — перерыв; весь день каждую неделю — выходной; по датам — по значку. */
export function groupOf(t: TimeOff): Group {
  if (t.startTime) return 'break'
  if (t.weekday) return 'dayOff'
  return LEAVE_EMOJI.has(t.emoji ?? '') ? 'leave' : 'dayOff'
}

// Винительный падеж для «Каждую пятницу», «Каждый вторник», «Каждое воскресенье»
const ON_WEEKDAY: Record<Weekday, string> = {
  MONDAY: 'Каждый понедельник', TUESDAY: 'Каждый вторник', WEDNESDAY: 'Каждую среду', THURSDAY: 'Каждый четверг',
  FRIDAY: 'Каждую пятницу', SATURDAY: 'Каждую субботу', SUNDAY: 'Каждое воскресенье',
}
const ORDER = WEEK.map(([code]) => code)
const WORKDAYS = ORDER.slice(0, 5)
const byWeek = (a?: Weekday, b?: Weekday) => ORDER.indexOf(a!) - ORDER.indexOf(b!)

/** «Каждую пятницу», «По будням», «Каждый день», «Пн, ср, пт». */
export function weekdaysText(days: Weekday[]): string {
  const sorted = [...new Set(days)].sort(byWeek)
  if (sorted.length === 1) return ON_WEEKDAY[sorted[0]!]
  if (sorted.length === 7) return 'Каждый день'
  if (sorted.join() === WORKDAYS.join()) return 'По будням'
  const short = sorted.map((d) => WEEK.find(([code]) => code === d)![2].toLowerCase()).join(', ')
  return short.charAt(0).toUpperCase() + short.slice(1)
}

const parts = (d: string) => {
  const date = new Date(`${d}T00:00:00Z`)
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', ...o }).format(date)
  return { day: f({ day: 'numeric' }), dayMonth: f({ day: 'numeric', month: 'long' }), month: date.getUTCMonth() }
}

/** «12 ноября», «12–20 ноября», «28 октября – 3 ноября». */
export function datesText(first?: string, last?: string): string {
  if (!first) return ''
  const a = parts(first)
  if (!last || last === first) return a.dayMonth
  const b = parts(last)
  return a.month === b.month ? `${a.day}–${b.dayMonth}` : `${a.dayMonth} – ${b.dayMonth}`
}

/** «Каждую пятницу, 12:00–14:00», «Каждое воскресенье, весь день», «12–20 ноября». */
function whenOf(items: TimeOff[]): string {
  const t = items[0]!
  const hours = t.startTime && t.endTime ? `${t.startTime.slice(0, 5)}–${t.endTime.slice(0, 5)}` : 'весь день'
  if (t.weekday) return `${weekdaysText(items.map((i) => i.weekday!))}, ${hours}`
  const days = datesText(t.firstDay, t.lastDay)
  return t.startTime ? `${days}, ${hours}` : days
}

/** Когда действует одна запись — как в списке. */
export function timeOffWhen(t: TimeOff): string {
  return whenOf([t])
}

/** Строка списка: записи с разными днями недели, но одним временем и названием — вместе (обед пн–пт — пять записей). */
export type Row = { ids: number[]; first: TimeOff; when: string; weekdays: Weekday[] }

export function rowsOf(list: TimeOff[]): Row[] {
  const groups = new Map<string, TimeOff[]>()
  for (const t of list) {
    const key = t.weekday ? ['w', t.doctorId ?? '', t.startTime ?? '', t.endTime ?? '', t.title ?? '', t.emoji ?? ''].join('|') : `id|${t.id}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  // Сначала еженедельные (по первому дню недели и времени), потом по датам
  const sortKey = (t: TimeOff) => t.weekday ? `0|${t.startTime ?? ''}|${ORDER.indexOf(t.weekday)}` : `1|${t.firstDay ?? ''}|${t.startTime ?? ''}`
  return [...groups.values()].map((items) => {
    const sorted = [...items].sort((a, b) => byWeek(a.weekday, b.weekday))
    return { ids: sorted.map((i) => i.id!), first: sorted[0]!, when: whenOf(sorted), weekdays: sorted.flatMap((i) => (i.weekday ? [i.weekday] : [])) }
  }).sort((a, b) => sortKey(a.first).localeCompare(sortKey(b.first)))
}

/** Несколько дат праздника: подряд идущие — один период (21, 22, 23 марта → 21–23 марта). */
export function toRanges(dates: string[]): [string, string][] {
  const sorted = [...new Set(dates.filter(Boolean))].sort()
  const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const ranges: [string, string][] = []
  for (const d of sorted) {
    const last = ranges.at(-1)
    if (last && next(last[1]) === d) last[1] = d
    else ranges.push([d, d])
  }
  return ranges
}
