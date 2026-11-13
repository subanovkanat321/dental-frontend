import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { seesAllMoney } from '../lib/roles'

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


/**
 * Значение поля «Чей расход»: '' — клиника, иначе id врача. По умолчанию — fallback (врач из фильтра кассы
 * или врач приёма); сменился он — поле следует за ним (без эффекта: сравниваем при отрисовке).
 */
export function useExpenseOwner(fallback: number | null | undefined) {
  const initial = fallback == null ? '' : String(fallback)
  const [state, setState] = useState({ from: initial, value: initial })
  const value = state.from === initial ? state.value : initial
  return [value, (v: string) => setState({ from: initial, value: v })] as const
}

/** id врача для тела запроса: кто видит всех — выбранный ('' — клиника); врач — он сам (сервер всё равно ставит его). */
export function ownerDoctorId(me: Schemas['BookingViewsMe'], owner: string): number | undefined {
  if (!seesAllMoney(me)) return me.doctorId ?? undefined
  return owner ? Number(owner) : undefined
}
