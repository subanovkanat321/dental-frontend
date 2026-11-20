import type { Schemas } from '../api/client'
import { somText } from './time'

export type DiscountReason = NonNullable<Schemas['PaymentDiscount']['reason']>

/** Причины скидки — как на сервере (DiscountReason), по-русски; «Другое» — с комментарием. */
export const DISCOUNT_REASONS: [DiscountReason, string][] = [
  ['PROMO', 'Акция'], ['FAMILY', 'Родственник/сотрудник'], ['VIP', 'ВИП'], ['REGULAR', 'Постоянный пациент'], ['OTHER', 'Другое'],
]

export const reasonText = (r?: DiscountReason) => DISCOUNT_REASONS.find(([k]) => k === r)?.[1] ?? ''

/**
 * Сумма скидки — подсказка в форме, как считает сервер: процент от цены с округлением до сома (половина вверх —
 * Math.round у положительных так и делает). Итог всё равно считает и проверяет сервер.
 */
export function discountSom(price: number, kind: 'percent' | 'som', value: number): number {
  if (!(price > 0) || !(value > 0)) return 0
  return kind === 'percent' ? Math.round((price * value) / 100) : value
}

/** «Скидка 10 % — 600 сом» или «Скидка 600 сом» — как в квитанции. */
export function discountText(d: { som: number; percent?: number | null }): string {
  return d.percent != null ? `Скидка ${d.percent} % — ${somText(d.som)}` : `Скидка ${somText(d.som)}`
}
