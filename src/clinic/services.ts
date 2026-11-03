import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'

type Service = Schemas['ServiceTypeView']

/** Стандартные категории услуг — как в приложении (state.js бэкенда): так пациент видит их в боте. */
export const SERVICE_CATEGORIES = ['Консультация', 'Диагностика', 'Анестезия', 'Терапия', 'Эндодонтия', 'Хирургия',
  'Имплантация', 'Пародонтология', 'Гигиена и отбеливание', 'Эстетика', 'Ортопедия', 'Ортодонтия', 'Детская стоматология']

/** «от 2 000 сом»; цены нет — null (пациентам не показываем). */
export function priceText(som?: number | null): string | null {
  return som == null ? null : `от ${new Intl.NumberFormat('ru-RU').format(som)} сом`
}

/**
 * Услуги группами по категории: сначала стандартные по порядку, свои — по алфавиту, без
 * категории («Другое») — последними. Внутри группы — как пришли с сервера.
 */
export function groupByCategory(services: Service[]): { category: string | null; items: Service[] }[] {
  const groups = new Map<string | null, Service[]>()
  for (const s of services) {
    const key = s.category || null
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const rank = (c: string | null): [number, string] => {
    if (c === null) return [2, '']
    const i = SERVICE_CATEGORIES.indexOf(c)
    return i >= 0 ? [0, String(i).padStart(3, '0')] : [1, c.toLowerCase()]
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [ra, ka] = rank(a)
      const [rb, kb] = rank(b)
      return ra - rb || ka.localeCompare(kb, 'ru')
    })
    .map(([category, items]) => ({ category, items }))
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
