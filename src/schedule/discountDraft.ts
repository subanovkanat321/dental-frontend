import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { discountSom, type DiscountReason } from '../lib/discount'

type Policy = Schemas['DiscountPoliciesPolicy']

/** Скидка в форме оплаты: процентом или суммой, размер, причина и комментарий (у «Другое» — обязателен). */
export type DiscountDraft = { kind: 'percent' | 'som'; value: string; reason: DiscountReason | ''; comment: string }

/** «Кто может давать скидку» и мой предел (GET /api/clinic/discounts). Нет ответа — скидки в форме нет. */
export function useDiscountPolicy() {
  return useQuery({
    queryKey: ['discount-policy'],
    queryFn: () => unwrap(api.GET('/api/clinic/discounts')),
    staleTime: 5 * 60_000,
  })
}

/** Скидка из уже отмеченной оплаты — в черновик формы «Изменить». */
export function draftOf(d?: Schemas['PaymentDiscount'] | null): DiscountDraft | null {
  if (!d) return null
  return d.percent != null
    ? { kind: 'percent', value: String(d.percent), reason: d.reason ?? '', comment: d.comment ?? '' }
    : { kind: 'som', value: String(d.som), reason: d.reason ?? '', comment: d.comment ?? '' }
}

/** Сколько скидки при этой цене — подсказка (итог считает сервер). */
export function draftSom(price: number | null, d: DiscountDraft | null): number {
  if (!d || price == null) return 0
  return discountSom(price, d.kind, Number(d.value))
}

/** Что не так со скидкой — текст ошибки; пусто — всё верно. Те же правила, что у сервера. */
export function draftProblem(price: number | null, d: DiscountDraft | null, policy?: Policy): string {
  if (!d) return ''
  const value = Number(d.value)
  if (!(value > 0) || !Number.isInteger(value)) return d.kind === 'percent' ? 'Впишите скидку в процентах' : 'Впишите скидку в сомах'
  if (!d.reason) return 'Выберите причину скидки'
  if (d.reason === 'OTHER' && !d.comment.trim()) return 'Напишите, за что скидка'
  if (price == null || price < 1) return 'Впишите цену приёма'
  if (d.kind === 'percent' && value > 100) return 'Скидка — до 100 %'
  if (d.kind === 'som' && value > price) return 'Скидка больше цены приёма'
  const max = policy?.myMaxPercent ?? 100
  if (draftSom(price, d) * 100 > price * max) return `Ваш предел скидки — до ${max} % от цены`
  return ''
}
