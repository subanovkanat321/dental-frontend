import type { Schemas } from '../api/client'
import { WEEK } from './texts'

type Schedule = Schemas['ShiftControllerSchedule']

/** День недели даты ('2099-06-01' → 'MONDAY'). */
export const weekdayOf = (date: string) => WEEK[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]![0]

/** Часы по недельному графику (V208) в этот день: смены нет — человек работает по нему; выходной — undefined. */
export function plannedOn(data: Schedule, telegramId: number, day: string) {
  const week = (data.weekly ?? []).find((w) => w.telegramId === telegramId)
  return week?.days?.find((d) => d.weekday === weekdayOf(day))
}
