import type { Lang } from './catalog'

/**
 * «Цена ожидания» на ценах клиники: из прайса (услуги и цены) по словам названия находим самую
 * низкую цену процедуры — показываем «от». Консультации, осмотры и снимки не считаем: «Консультация
 * по имплантации, 500 сом» не должна стать ценой импланта. Нет цены — шаг без числа.
 */
export type PriceKey = 'filling' | 'inlay' | 'canals' | 'crown' | 'extraction' | 'implant' | 'bone' | 'hygiene' | 'gums' | 'sealant'

export const PRICE_WORDS: Record<PriceKey, string[]> = {
  filling: ['пломб', 'кариес', 'реставрац'],
  inlay: ['вкладк'],
  canals: ['канал', 'пульпит', 'эндодонт'],
  crown: ['коронк'],
  extraction: ['удален'],
  implant: ['имплант'],
  bone: ['наращиван', 'костн', 'синус-лифт', 'синуслифт', 'аугментац'],
  hygiene: ['чистк', 'гигиен'],
  gums: ['пародонт', 'кюретаж', 'дёсн', 'десн', 'гингив'],
  sealant: ['герметиз', 'фиссур'],
}

const NOT_PROCEDURE = ['консульт', 'осмотр', 'диагност', 'снимок', 'рентген', 'кт ', 'план лечения']

export type PricedService = { name?: string | null; priceSom?: number | null; active?: boolean | null }

/** Самая низкая цена услуги, подходящей к ключу; нет — null. */
export function priceOf(services: PricedService[], key: PriceKey): number | null {
  const words = PRICE_WORDS[key]
  const prices = services
    .filter((s) => s.active !== false && s.priceSom != null && s.priceSom > 0)
    .filter((s) => {
      const n = `${(s.name ?? '').toLowerCase()} `
      return words.some((w) => n.includes(w)) && !NOT_PROCEDURE.some((w) => n.includes(w))
    })
    .map((s) => s.priceSom!)
  return prices.length ? Math.min(...prices) : null
}

/**
 * Цена шага: группы складываются, внутри группы — самая дешёвая услуга ([['extraction'], ['implant']]
 * — удаление и имплант; [['inlay', 'crown']] — вкладка или коронка). Хоть одной группы нет — null:
 * сумма без импланта ввела бы в заблуждение. Групп нет — шаг без цены (её не посчитать по прайсу).
 */
export function stepPrice(services: PricedService[], groups: PriceKey[][]): number | null {
  if (!groups.length) return null
  let total = 0
  for (const group of groups) {
    const found = group.map((k) => priceOf(services, k)).filter((p): p is number => p != null)
    if (!found.length) return null
    total += Math.min(...found)
  }
  return total
}

/** 12500 → «от 12 500 сом» / «12 500 сомдон баштап». */
export function fromSom(som: number, lang: Lang): string {
  const n = String(som).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return lang === 'ky' ? `${n} сомдон баштап` : `от ${n} сом`
}
