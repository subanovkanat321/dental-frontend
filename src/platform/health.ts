import type { Schemas } from '../api/client'

type Row = Schemas['PlatformServiceClinicRow']

/** Здоровье клиники для команды платформы: кто перестал заходить — позвонить первым. */
export const CLINIC_HEALTH: Record<string, { label: string; short: string; chip: string; order: number }> = {
  ASLEEP: { label: 'не заходят 7+ дней — позвонить', short: 'позвонить', chip: 's-bad', order: 0 },
  QUIET: { label: 'тихо: не заходят 3+ дня', short: 'тихо', chip: 's-wait', order: 1 },
  NEW: { label: 'новая — настраивается', short: 'новые', chip: 's-request', order: 2 },
  OK: { label: 'работает', short: 'работают', chip: 's-ok', order: 3 },
}

/** Сначала «уснувшие», внутри — по названию. */
export function byHealth(clinics: Row[]): Row[] {
  return [...clinics].sort((a, b) => (CLINIC_HEALTH[a.health ?? '']?.order ?? 9) - (CLINIC_HEALTH[b.health ?? '']?.order ?? 9)
    || (a.name ?? '').localeCompare(b.name ?? '', 'ru'))
}

/** Доля неявок в процентах; данных нет — null. */
export function noShowShare(noShow = 0, done = 0): number | null {
  return noShow + done > 0 ? Math.round((noShow / (noShow + done)) * 100) : null
}

/** «Оплачено до» + n месяцев: от старой даты, если ещё не прошла, иначе от даты оплаты. */
export function extendPaid(paidUntil: string | undefined, months: number, from: string): string {
  const start = paidUntil && paidUntil >= from ? paidUntil : from
  const [y, m, d] = start.split('-').map(Number)
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d!, last))
  return target.toISOString().slice(0, 10)
}
