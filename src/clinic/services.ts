import type { Schemas } from '../api/client'

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
