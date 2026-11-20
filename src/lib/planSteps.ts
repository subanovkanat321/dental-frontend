import type { Schemas } from '../api/client'
import { todayIn } from './time'

type Step = Schemas['TreatmentStepView']

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * Срок этапа (V241) — «до 15 дек»; другой год — «до 15 янв 2027». Срок — день по Бишкеку без времени ('2026-12-15'),
 * поэтому форматируем как UTC-дату: иначе в поясе браузера день мог бы сдвинуться.
 */
export function dueText(dueOn: string, today = todayIn()): string {
  const d = new Date(`${dueOn}T00:00:00Z`)
  const f = dueOn.slice(0, 4) === today.slice(0, 4) ? DAY_MONTH : DAY_MONTH_YEAR
  return `до ${f.format(d).replace(/\./g, '').replace(/ г$/, '')}`
}

/** «Иванова А. · до 15 дек» — врач и срок этапа одной строкой; ничего не назначено — ''. */
export function assignText(s: Pick<Step, 'doctorName' | 'dueOn'>, today = todayIn()): string {
  return [s.doctorName, s.dueOn ? dueText(s.dueOn, today) : null].filter(Boolean).join(' · ')
}

/** Сколько несделанных этапов просрочено — «просрочен этап» в шапке плана и в строке. */
export function overdueCount(steps: Step[]): number {
  return steps.filter((s) => s.overdue && !s.doneAt).length
}

/**
 * Этапы по зубам (печать «По зубам»): зубы по номеру FDI, внутри — как пришли; этапы на всю полость рта — последней
 * группой (tooth null).
 */
export function byTooth<T extends { tooth?: number | null }>(steps: T[]): { tooth: number | null; items: T[] }[] {
  const groups = new Map<number | null, T[]>()
  for (const s of steps) {
    const key = s.tooth ?? null
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : a - b))
    .map(([tooth, items]) => ({ tooth, items }))
}

/** «36, 46» / «36 46» / «36,46,» → [36, 46]; повторы убираем, порядок — как ввели. Не число — пропускаем. */
export function parseTeeth(text: string): number[] {
  const out: number[] = []
  for (const part of text.split(/[\s,;]+/)) {
    const n = Number(part)
    if (part && Number.isInteger(n) && !out.includes(n)) out.push(n)
  }
  return out
}
