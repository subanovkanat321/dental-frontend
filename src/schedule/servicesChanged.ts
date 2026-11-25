import type { Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

/**
 * Услуги поменяли после оплаты (добавили коронку, убрали снимок): сумма услуг (со скидками строк) не та, что в оплате (цена
 * до общей скидки) — «Услуги изменились: теперь 3 500 сом, в оплате 1 700 · Пересчитать» (QA 2026-11-25). Бесплатный и
 * «оплачено заранее» приём, приём без цен услуг — без подсказки. null — совпадает или сравнивать не с чем.
 */
export function servicesChanged(a: Appointment): { now: number; was: number } | null {
  if (a.paidSom == null || a.servicesTotalSom == null) return null
  if (a.paidSom === 0 && !a.chargeSom) return null
  const was = a.discount?.priceSom ?? a.chargeSom ?? a.paidSom
  return was !== a.servicesTotalSom ? { now: a.servicesTotalSom, was } : null
}
