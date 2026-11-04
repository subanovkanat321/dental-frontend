import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { seesOwnEarnings } from '../lib/roles'
import { somText } from '../lib/time'

type Me = Schemas['BookingViewsMe']
export type Earnings = Schemas['EarningsView']

/** Именительный падеж: «За ноябрь» (Intl даёт родительный — «ноября»). */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

/** '2026-11' → «ноябрь». */
export function monthName(month?: string): string {
  const m = Number(month?.slice(5, 7))
  return MONTHS[m - 1] ?? 'месяц'
}

/** 12400 → «12 400» — без «сом», когда «сом» уже рядом. */
export function number(som: number): string {
  return new Intl.NumberFormat('ru-RU').format(som)
}

/**
 * «Мой заработок» врача — один запрос на всё приложение (ключ ['earnings']): виджет в «Расписании»,
 * вкладка «Кассы» и «+1 200 сом к вашему дню» в карточке приёма читают один кэш. После оплаты
 * приёма его перечитывает refreshAppointmentData. Считает сервер — здесь только показываем.
 */
export function useEarnings(me: Me, enabled = true) {
  return useQuery({
    queryKey: ['earnings'],
    queryFn: () => unwrap(api.GET('/api/me/earnings')),
    enabled: enabled && seesOwnEarnings(me),
    staleTime: 60_000,
  })
}

/** Главная сумма дня: с процентом — заработок, без условий — принятое от пациентов. */
export function todayOf(e: Earnings): number {
  return Number(e.percent ?? 0) > 0 || !e.hasTerms ? e.todaySom ?? 0 : e.todayRevenueSom ?? 0
}

/** Доля пути к цели, 0–1; цели нет — null. */
export function goalShare(e: Earnings): number | null {
  if (!e.goalSom) return null
  return Math.min(1, Math.max(0, (e.monthSom ?? 0) / e.goalSom))
}

/** «−1 200 сом» / «1 200 сом» — минус, когда сумма ниже нуля. */
export const signedSom = (som: number) => (som < 0 ? `−${somText(-som)}` : somText(som))

/** Родительный падеж — «у 1 материала», «у 3 материалов», «у 21 материала». */
export function materialsWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? `${n} материала` : `${n} материалов`
}
