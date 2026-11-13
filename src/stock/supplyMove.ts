import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate, somText, todayIn } from '../lib/time'

type Supply = Schemas['SupplyView']

/** Склад, история материала и «Расходы на склад» — перечитать после любого изменения материала. */
export function useStockRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['supplies'] })
    void client.invalidateQueries({ queryKey: ['supply-history'] })
    void client.invalidateQueries({ queryKey: ['spending'] })
  }
}

type Vars = { supply: Supply; delta: number }

/**
 * «Пришла поставка» и «Списать» — одна логика для карточки материала и для «＋ Поставка» в «Расходах
 * на склад»: сколько, сумма поставки (пойдёт в расходы), дата поставки (по умолчанию сегодня, прошлое
 * можно, будущее — нет; сервер проверяет то же). Тот же запрос `/api/supplies/{id}/move`.
 *
 * @param named в сообщении «Принято …» назвать материал (в листе поставки материал выбирают — его
 *              полезно повторить; в карточке он и так в заголовке)
 */
export function useSupplyMove({ named = false }: { named?: boolean } = {}) {
  const refresh = useStockRefresh()
  const [amount, setAmount] = useState('1')
  const [cost, setCost] = useState('')
  const [deliveredOn, setDeliveredOn] = useState(todayIn())
  const [done, setDone] = useState('')
  const move = useMutation<Supply, ApiError, Vars>({
    mutationFn: ({ supply, delta }) => unwrap(api.POST('/api/supplies/{id}/move', {
      params: { path: { id: supply.id } },
      body: {
        delta, reason: delta < 0 ? 'USE' : 'DELIVERY', costSom: delta > 0 && cost ? Number(cost) : undefined,
        deliveredOn: delta > 0 && deliveredOn !== todayIn() ? deliveredOn : undefined,
      },
    })),
    onSuccess: (_updated, { supply: s, delta }) => {
      const what = named ? `: ${s.name}` : ''
      setDone(delta < 0 ? `Списано ${-delta} ${s.unit}${what}` : `Принято ${delta} ${s.unit}${what}${cost ? ` · ${somText(Number(cost))}` : ''}`
        + (delta > 0 && deliveredOn !== todayIn() ? ` · поставка ${shortDate(`${deliveredOn}T12:00:00Z`)}` : ''))
      setCost('')
      setDeliveredOn(todayIn())
      refresh()
    },
  })
  const n = Math.trunc(Number(amount))
  /** Списать (−1) или принять (+1) n единиц этого материала; n не целое больше 0 — ничего. */
  const submit = (supply: Supply, sign: 1 | -1) => {
    setDone('')
    move.reset()
    if (!(n > 0)) return
    move.mutate({ supply, delta: sign * n })
  }
  const error = move.error && (move.error.fieldErrors.delta ?? move.error.fieldErrors.costSom ?? move.error.fieldErrors.deliveredOn ?? move.error.message)
  return { amount, setAmount, cost, setCost, deliveredOn, setDeliveredOn, n, done, setDone, move, submit, error }
}

export type SupplyMove = ReturnType<typeof useSupplyMove>
