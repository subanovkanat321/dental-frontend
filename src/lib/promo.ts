import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

export type PromoCode = Schemas['PromoCodesCode']

/**
 * Промокоды клиники (V122 бэкенда): «Настройки → Откуда приходят пациенты → Промокоды», выбор в записи. Один запрос на все
 * экраны; после правки ответ сервера кладём в этот же ключ.
 */
export function usePromoCodes() {
  return useQuery({ queryKey: ['promo-codes'], queryFn: () => unwrap(api.GET('/api/promo-codes')), staleTime: 5 * 60_000 })
}

/** Скидка-подсказка словами: «−10% · Консультация бесплатно»; нет скидки — пусто. */
export function discountText(p: { discountPercent?: number | null; discountText?: string | null }): string {
  return [p.discountPercent ? `−${p.discountPercent}%` : '', p.discountText ?? ''].filter(Boolean).join(' · ')
}

/** Код подходит для ссылки t.me (start-параметр — только латиница и цифры). */
export function linkable(code: string | undefined): boolean {
  return /^[A-Za-z0-9]{3,20}$/.test(code ?? '')
}

/** Срок прошёл: последний день — validUntil (по Бишкеку), сегодня уже позже. */
export function expired(p: PromoCode, today: string): boolean {
  return p.validUntil != null && p.validUntil < today
}
