import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'

/** Как делить общий расход; первый — по умолчанию (сервер — Expenses.SPLIT_KEYS). */
export const SPLIT_KEYS: [string, string, string][] = [
  ['CHAIRS', 'По креслам', 'поровну на кресла, доля кресла — поровну между его врачами; врачи без кресла не участвуют'],
  ['DOCTORS', 'Поровну на врачей', 'поровну на всех работающих врачей'],
  ['REVENUE', 'По выручке за месяц', 'пропорционально выручке врачей за месяц расхода (пересчитывается до конца месяца)'],
  ['MANUAL', 'Вручную', 'суммы по врачам — в сумме ровно расход'],
]

export const splitTitle = (key?: string | null) => SPLIT_KEYS.find(([k]) => k === key)?.[1] ?? ''

/** «Материалы»: покупки мимо склада. Поставку на склад сюда не пишут — посчитается дважды. */
export const MATERIALS = 'Материалы'
export const MATERIALS_HINT = 'Если покупку заводите на склад через «Пришла поставка» — сюда не пишите, иначе посчитается дважды.'

/** Готовые статьи и свои, которые клиника уже вписывала, — один кэш на приложение. */
export function useCategories() {
  return useQuery({ queryKey: ['expense-categories'], queryFn: () => unwrap(api.GET('/api/expenses/categories')), staleTime: 10 * 60_000 })
}

