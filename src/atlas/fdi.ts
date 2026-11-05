import type { Lang } from './content'
import { isFdi } from './ids'

/**
 * Номера зубов по FDI (как в зубной формуле CRM): первая цифра — четверть, вторая — зуб от середины.
 * 1 — верх справа, 2 — верх слева, 3 — низ слева, 4 — низ справа (справа/слева — у пациента).
 * В 3D-челюсти зубы лежат массивом из 32: индекс = (четверть − 1) × 8 + (зуб − 1).
 */

export const ALL_FDI: readonly number[] = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => q * 10 + n))

export { isFdi }

/** Номер FDI → индекс сетки зуба в челюсти; не зуб — null. */
export function fdiToIndex(code: number): number | null {
  if (!isFdi(code)) return null
  return (Math.floor(code / 10) - 1) * 8 + (code % 10) - 1
}

export function indexToFdi(index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index > 31) return null
  return (Math.floor(index / 8) + 1) * 10 + (index % 8) + 1
}

export type ToothKind = 'central' | 'lateral' | 'canine' | 'premolar1' | 'premolar2' | 'molar1' | 'molar2' | 'molar3'
const KINDS: readonly ToothKind[] = ['central', 'lateral', 'canine', 'premolar1', 'premolar2', 'molar1', 'molar2', 'molar3']

export function toothKind(code: number): ToothKind {
  return KINDS[(code % 10) - 1] ?? 'molar1'
}

export const isUpper = (code: number) => Math.floor(code / 10) <= 2
/** Справа у пациента: на экране (смотрим пациенту в лицо) — слева. */
export const isPatientRight = (code: number) => [1, 4].includes(Math.floor(code / 10))

const NAMES: Record<Lang, Record<ToothKind, string>> = {
  ru: {
    central: 'центральный резец', lateral: 'боковой резец', canine: 'клык', premolar1: 'первый премоляр',
    premolar2: 'второй премоляр', molar1: 'первый моляр', molar2: 'второй моляр', molar3: 'зуб мудрости',
  },
  // ky: нужна проверка носителем
  ky: {
    central: 'борбордук кесүүчү тиш', lateral: 'капталдагы кесүүчү тиш', canine: 'сойлоочу тиш', premolar1: 'биринчи кичи азуу',
    premolar2: 'экинчи кичи азуу', molar1: 'биринчи азуу тиш', molar2: 'экинчи азуу тиш', molar3: 'акыл тиш',
  },
}

/** «36 — первый моляр, низ слева» — подпись выделенного зуба. */
export function toothTitle(code: number, lang: Lang): string {
  const jaw = lang === 'ru' ? (isUpper(code) ? 'верх' : 'низ') : (isUpper(code) ? 'үстүңкү жаак' : 'астыңкы жаак')
  const side = lang === 'ru' ? (isPatientRight(code) ? 'справа' : 'слева') : (isPatientRight(code) ? 'оң жак' : 'сол жак')
  return `${code} — ${NAMES[lang][toothKind(code)]}, ${jaw} ${side}`
}
