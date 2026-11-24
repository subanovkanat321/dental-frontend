import type { Schemas } from '../api/client'
import { priceOf, type PriceDraft } from '../medical/stepDiscount'

type Line = Schemas['ServiceLine']
type Policy = Schemas['DiscountPoliciesPolicy']

/**
 * Скидка строки услуги (V258 бэкенда) в форме — как у этапа плана (PriceDraft), но цена — за единицу: «7 000 → 6 000 за
 * коронку», а скидка на сервере — на всю строку (× количество). Строка со скидкой: цена до скидки — цена строки, цена за
 * единицу — итог / количество (не делится ровно — процентом или как было).
 */
export function fromLine(line: Pick<Line, 'priceSom' | 'qty' | 'amountSom' | 'discountPercent' | 'discountSom' | 'netSom'>): PriceDraft {
  if (line.priceSom == null) return { price: '', ref: null, discount: null }
  if (line.netSom == null || !line.discountSom) return { price: String(line.priceSom), ref: line.priceSom, discount: null }
  if (line.discountPercent != null) {
    return { price: String(Math.round(line.netSom / line.qty)), ref: line.priceSom, discount: { kind: 'percent', value: line.discountPercent } }
  }
  const unit = line.discountSom / line.qty
  return { price: String(line.priceSom - Math.round(unit)), ref: line.priceSom, discount: { kind: 'som', value: Math.round(unit) } }
}

/**
 * Тело PUT строки: цена за единицу и скидка на строку. Цена ниже цены строки — скидка на разницу × количество; нельзя по
 * «Настройки → Скидки» — просто новая цена (как раньше). Скидки нет — снять (`{}`).
 */
export function lineMoney(d: PriceDraft, qty: number, policy?: Policy): {
  priceSom?: number; discount: { percent?: number; som?: number }; off: number; blocked: string
} {
  const p = priceOf(d, policy)
  const discount = p.discount?.percent != null ? { percent: p.discount.percent }
    : p.discount?.som != null ? { som: p.discount.som * qty } : {}
  return { priceSom: p.priceSom, discount, off: p.off * qty, blocked: p.blocked }
}
