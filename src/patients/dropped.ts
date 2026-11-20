import type { Schemas } from '../api/client'

type Row = Schemas['PlanStatesDropped']

/**
 * Вежливый текст для WhatsApp — продолжить лечение. Без цен и без давления; имя и клиника — чтобы было понятно, кто
 * пишет. Текст уходит только в WhatsApp на устройстве сотрудника — у нас нигде не сохраняется.
 */
export function continueText(row: Pick<Row, 'fullName' | 'left'>, clinic?: string): string {
  const hello = row.fullName?.trim() ? `Здравствуйте, ${row.fullName.trim()}!` : 'Здравствуйте!'
  const who = clinic ? ` Это ${clinic}.` : ''
  const steps = (row.left ?? []).length ? `\n\nПо плану лечения осталось:\n${(row.left ?? []).map((s) => `• ${s}`).join('\n')}` : ''
  return `${hello}${who} Давно вас не видели — как вы себя чувствуете?${steps}\n\n`
    + 'Лучше не откладывать: незаконченное лечение со временем может стать сложнее и дороже. Подберём удобное время, '
    + 'чтобы продолжить? Ответьте на это сообщение — запишем.'
}

/** «1 пациент», «3 пациента», «5 пациентов». */
export function patientsWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'пациент'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'пациента'
  return 'пациентов'
}
