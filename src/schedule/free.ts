import type { Schemas } from '../api/client'
import { minutesOf } from '../lib/time'

/** Свободные минуты врача из окон /api/slots; сегодня — только то, что ещё впереди. */
export function freeMinutes(windows: Schemas['TimeRange'][], nowMinutes: number | null): { minutes: number; first: number | null } {
  let minutes = 0
  let first: number | null = null
  for (const w of windows) {
    const start = Math.max(minutesOf(w.start), nowMinutes ?? 0)
    const end = minutesOf(w.end) || 24 * 60
    if (end - start < 15) continue
    minutes += end - start
    if (first == null) first = start
  }
  return { minutes, first: first == null ? null : Math.ceil(first / 5) * 5 }
}

