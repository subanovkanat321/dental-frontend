import type { Schemas } from '../api/client'
import { somText, todayIn } from '../lib/time'

export { textMatches as nameMatches } from '../lib/search'

type Service = Schemas['ServiceTypeView']

/** Раздел услуги (V169 бэкенда) — фиксированный список; сервер присылает его у каждой услуги. */
export type ServiceGroup = NonNullable<Service['group']>

/** Разделы по порядку — так они идут в списках, чипах и выборе услуги: [код, по-русски, по-кыргызски]. */
export const SERVICE_GROUPS: readonly (readonly [ServiceGroup, string, string])[] = [
  ['EXAM', 'Осмотр и консультация', 'Кароо жана консультация'],
  ['HYGIENE', 'Профилактика и гигиена', 'Алдын алуу жана гигиена'],
  ['THERAPY', 'Терапия', 'Терапия'],
  ['SURGERY', 'Хирургия', 'Хирургия'],
  ['PROSTHETICS', 'Ортопедия', 'Ортопедия'],
  ['ORTHODONTICS', 'Ортодонтия', 'Ортодонтия'],
  ['IMPLANTS', 'Имплантация', 'Имплантация'],
  ['AESTHETICS', 'Эстетика', 'Эстетика'],
  ['KIDS', 'Детская стоматология', 'Балдар стоматологиясы'],
  ['XRAY', 'Рентген и диагностика', 'Рентген жана диагностика'],
  ['OTHER', 'Другое', 'Башка'],
]

/** «THERAPY» → «Терапия» (ky — по-кыргызски, для самозаписи пациента). */
export function groupLabel(group: ServiceGroup | null | undefined, lang: 'ru' | 'ky' = 'ru'): string {
  const row = SERVICE_GROUPS.find(([code]) => code === (group ?? 'OTHER')) ?? SERVICE_GROUPS[SERVICE_GROUPS.length - 1]!
  return lang === 'ky' ? row[2] : row[1]
}

/** «от 2 000 сом»; цены нет — null (пациентам не показываем). */
export function priceText(som?: number | null): string | null {
  return som == null ? null : `от ${somText(som)}`
}

/**
 * Услуги группами по разделу — в порядке {@link SERVICE_GROUPS}, пустых разделов нет. Внутри
 * группы — как пришли с сервера. Раздела нет (старый ответ) — «Другое».
 */
export function groupServices<S extends { group?: ServiceGroup }>(services: S[]): { group: ServiceGroup; items: S[] }[] {
  return SERVICE_GROUPS
    .map(([group]) => ({ group, items: services.filter((s) => (s.group ?? 'OTHER') === group) }))
    .filter((g) => g.items.length > 0)
}

/** «Профосмотр через»: варианты срока в месяцах — в карточке услуги и сроке клиники. */
export const RECALL_CHOICES = [1, 2, 3, 4, 6, 9, 12, 18, 24]

/** Варианты с текущим значением: срок, заданный не из списка (через API), не пропадёт. */
export function recallChoices(current?: number | null): number[] {
  return current == null || RECALL_CHOICES.includes(current) ? RECALL_CHOICES : [...RECALL_CHOICES, current].sort((a, b) => a - b)
}

/** 6 → «6 мес.» */
export function monthsText(months: number): string {
  return `${months} мес.`
}

/** «2026-10-03» → «3 октября» (год — если не текущий). Дата уже по Бишкеку — считает сервер. */
export function dueText(date: string, today = todayIn()): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric' })
    .format(new Date(`${date}T00:00:00Z`)).replace(/ г\.?$/, '')
}
