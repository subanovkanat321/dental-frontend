import type { Schemas } from '../api/client'
import { WEEK, type Weekday } from './texts'
import { weekdaysText } from './timeOffTexts'

type Schedule = Schemas['ShiftControllerSchedule']
type Weekly = Schemas['ShiftServiceWeekly']

/** День недели даты ('2099-06-01' → 'MONDAY'). */
export const weekdayOf = (date: string) => WEEK[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]![0]

/** Часы по недельному графику (V208) в этот день: смены нет — человек работает по нему; выходной — undefined. */
export function plannedOn(data: Schedule, telegramId: number, day: string) {
  const week = (data.weekly ?? []).find((w) => w.telegramId === telegramId)
  return week?.days?.find((d) => d.weekday === weekdayOf(day))
}

/** «Пн–Пт 09–18» — коротко, для строки графика и карточки. */
export function weeklyText(w: Weekly | undefined): string {
  const days = w?.days ?? []
  if (!days.length) return 'выходные все дни'
  const hours = new Set(days.map((d) => `${(d.start ?? '').slice(0, 5)}–${(d.end ?? '').slice(0, 5)}`))
  const names = weekdaysText(days.map((d) => d.weekday as Weekday))
  return hours.size === 1 ? `${names} ${[...hours][0]}` : days.map((d) => {
    const short = WEEK.find(([code]) => code === d.weekday)?.[2] ?? ''
    return `${short} ${(d.start ?? '').slice(0, 5)}–${(d.end ?? '').slice(0, 5)}`
  }).join(', ')
}
