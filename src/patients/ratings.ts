import type { Schemas } from '../api/client'

type Summary = Schemas['RatingSummary']

/** С скольких символов жалоба сворачивается в две строки (короче — помещается и так). */
export const LONG_COMPLAINT = 110

/** Сколько оценок 1–3 ★ — жалобы: из той же сводки, что «Касса → Статистика» (RatingSummary). */
export function lowCount(r: Summary): number {
  return (r.byStars ?? []).slice(0, 3).reduce((s, n) => s + n, 0)
}

/** «4,3» — средняя оценка, как в «Статистике». */
export function averageText(r: Summary): string {
  return r.average == null ? '—' : String(r.average).replace('.', ',')
}
