import type { Schemas } from '../api/client'

type Slots = Schemas['BookingViewsSlots']

/** Правила ленты дней и поиска свободного времени — общие для записи в Telegram и на сайте. */

/** Сколько дней в ленте: столько, на сколько вперёд сервер даёт записаться (daysAhead и сегодня); нет — две недели. */
export function stripLength(daysAhead?: number | null): number {
  return daysAhead ? Math.min(daysAhead + 1, 62) : 14
}

/** Дней за раз при поиске первого свободного: по неделе, параллельно. */
const WEEK = 7

/**
 * Первый день со свободным временем (сегодня мест нет — завтра и т. д.) — по порядку дней, а не
 * какой ответ пришёл раньше. Всё пусто — первый день и noneSoon.
 */
export async function firstFree(days: string[], load: (d: string) => Promise<Slots>): Promise<{ date: string; slots: Slots; noneSoon: boolean }> {
  let first: Slots | undefined
  for (let i = 0; i < days.length; i += WEEK) {
    const batch = days.slice(i, i + WEEK)
    const found = await Promise.all(batch.map(load))
    first ??= found[0]
    const free = found.findIndex((x) => x.starts?.length)
    if (free >= 0) return { date: batch[free]!, slots: found[free]!, noneSoon: false }
  }
  return { date: days[0]!, slots: first ?? await load(days[0]!), noneSoon: true }
}

/** «10:30» → 630 минут от полуночи. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}
