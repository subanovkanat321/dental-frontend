import type { Schemas } from '../api/client'
import { ageYears } from '../lib/age'
import { todayIn } from '../lib/time'

export { ageYears }

/**
 * Прикус на карте зубов (детская стоматология, V163 бэкенда): какие зубы рисовать в формуле.
 * - PERMANENT — постоянные 11–48;
 * - PRIMARY — молочные 51–55, 61–65, 71–75, 81–85 (четверти 5–8, зубы 1–5: та же сторона и место в ряду,
 *   что у постоянного, который придёт на смену: 51 → 11, 85 → 45);
 * - MIXED — сменный: на местах 1–5 молочный, пока он есть, иначе постоянный; на местах 6–8 — постоянные моляры.
 * Врач выбирает прикус переключателем, он сохраняется у пациента (PatientView.dentition); не выбирал — по возрасту.
 */
export type Dentition = NonNullable<Schemas['PatientView']['dentition']>

export const DENTITIONS: [Dentition, string][] = [
  ['PERMANENT', 'Постоянные'],
  ['PRIMARY', 'Молочные'],
  ['MIXED', 'Сменный'],
]

/** По возрасту — как Dentition.byAge бэкенда: до 6 лет — молочные, 6–12 — сменный, старше (и без даты) — постоянные. */
export function dentitionByAge(birth?: string | null, today = todayIn()): Dentition {
  const years = ageYears(birth, today)
  if (years == null) return 'PERMANENT'
  return years < 6 ? 'PRIMARY' : years <= 12 ? 'MIXED' : 'PERMANENT'
}

/** Прикус карты: выбранный у пациента, иначе по возрасту. */
export function dentitionOf(p?: { dentition?: Dentition | null; birthDate?: string | null } | null, today = todayIn()): Dentition {
  return p?.dentition ?? dentitionByAge(p?.birthDate, today)
}

/** Молочный зуб: 51–55, 61–65, 71–75, 81–85. */
export function isPrimaryTooth(n: number): boolean {
  const q = Math.floor(n / 10)
  const pos = n % 10
  return q >= 5 && q <= 8 && pos >= 1 && pos <= 5
}

/** Номер по FDI — постоянный или молочный (как Teeth.valid бэкенда). */
export function isToothNumber(n: number): boolean {
  const q = Math.floor(n / 10)
  const pos = n % 10
  return Number.isInteger(n) && ((q >= 1 && q <= 4 && pos >= 1 && pos <= 8) || isPrimaryTooth(n))
}

/** Молочный зуб на месте постоянного (11 → 51, 45 → 85); на месте моляров 6–8 молочных нет — null. */
export function primaryOf(permanent: number): number | null {
  const pos = permanent % 10
  return pos >= 1 && pos <= 5 ? permanent + 40 : null
}

type Charted = { number?: number; state?: string }

/**
 * Номер, который рисовать на месте постоянного зуба {@code permanent}. Сменный прикус: молочный, пока он не
 * отмечен «удалён» (выпал или удалили) и постоянный на его месте ещё не отмечали на карте (значит, не прорезался).
 */
export function toothAt(permanent: number, dentition: Dentition, teeth?: readonly Charted[]): number | null {
  const primary = primaryOf(permanent)
  if (dentition === 'PERMANENT') return permanent
  if (dentition === 'PRIMARY') return primary
  if (primary == null) return permanent
  const byNumber = new Map((teeth ?? []).map((t) => [t.number, t.state]))
  const primaryGone = byNumber.get(primary) === 'MISSING'
  return primaryGone || byNumber.has(permanent) ? permanent : primary
}
