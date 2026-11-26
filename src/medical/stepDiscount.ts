import type { Schemas } from '../api/client'
import { addDays, somText } from '../lib/time'

type Step = Schemas['TreatmentStepView']
type Policy = Schemas['DiscountPoliciesPolicy']

/** Скидка этапа плана (V257 бэкенда): процентом или суммой. */
export type StepDiscount = { kind: 'percent' | 'som'; value: number }

/**
 * Цена этапа в форме: `price` — что пациент заплатит за зуб (поле «Цена»), `ref` — цена до скидки (по прайсу или вписанная
 * до скидки), `discount` — скидка. Поле цены и скидка согласованы: вписали цену ниже прайса — это скидка на разницу;
 * выбрали скидку — цена пересчиталась.
 */
export type PriceDraft = { price: string; ref: number | null; discount: StepDiscount | null }

export const EMPTY_PRICE: PriceDraft = { price: '', ref: null, discount: null }

/** Частые скидки в процентах — кнопками, как в оплате */
export const QUICK_PERCENTS = [5, 10, 15, 20]

/** Сумма скидки от цены — как сервер: процент с округлением до сома (половина вверх), сумма — не больше цены. */
export function discountAmount(base: number, d: StepDiscount | null): number {
  if (!d || !(base > 0) || !(d.value > 0)) return 0
  return d.kind === 'percent' ? Math.round((base * d.value) / 100) : Math.min(d.value, base)
}

/** Выбрали услугу прайса — цена прайса, без скидки. */
export function fromList(listPrice: number | null | undefined): PriceDraft {
  return listPrice != null ? { price: String(listPrice), ref: listPrice, discount: null } : EMPTY_PRICE
}

/** Этап как есть — в форму правки: цена — со скидкой, цена до скидки — цена этапа. */
export function fromStep(s: Pick<Step, 'priceSom' | 'netSom' | 'discountPercent' | 'discountSom'>): PriceDraft {
  if (s.priceSom == null) return EMPTY_PRICE
  if (s.netSom == null || s.discountSom == null) return { price: String(s.priceSom), ref: null, discount: null }
  return {
    price: String(s.netSom),
    ref: s.priceSom,
    discount: s.discountPercent != null ? { kind: 'percent', value: s.discountPercent } : { kind: 'som', value: s.discountSom },
  }
}

/** Вписали цену: ниже цены до скидки — скидка на разницу; не ниже — просто цена, без скидки. */
export function typePrice(d: PriceDraft, value: string): PriceDraft {
  const p = Number(value)
  if (value === '' || !(p >= 0) || d.ref == null) return { price: value, ref: d.ref, discount: null }
  if (p < d.ref) return { price: value, ref: d.ref, discount: { kind: 'som', value: d.ref - p } }
  return { price: value, ref: d.ref, discount: null }
}

/** Выбрали скидку (или убрали — null): цена до скидки остаётся, цена со скидкой пересчиталась. */
export function setDiscount(d: PriceDraft, discount: StepDiscount | null): PriceDraft {
  const ref = d.ref ?? (d.price === '' ? null : Number(d.price))
  if (ref == null) return d
  if (!discount || !(discount.value > 0)) return { price: String(ref), ref, discount: null }
  return { price: String(ref - discountAmount(ref, discount)), ref, discount }
}

/**
 * Что отправить серверу и что сказать под полем.
 *
 * - `priceSom` / `discount` — тело запроса (скидка — только если её можно дать);
 * - `off` — скидка в сомах, `base` — цена до скидки;
 * - `blocked` — скидку дать нельзя (политика «Настройки → Пациенты и скидки → Скидки»): сохраним просто цену этапа, как раньше, — решает руководитель.
 */
export function priceOf(d: PriceDraft, policy?: Policy): {
  priceSom?: number; discount?: { percent?: number; som?: number }; off: number; base: number | null; blocked: string
} {
  if (d.price === '') return { off: 0, base: null, blocked: '' }
  const price = Number(d.price)
  if (!d.discount || d.ref == null) return { priceSom: price, off: 0, base: price, blocked: '' }
  const off = discountAmount(d.ref, d.discount)
  if (off <= 0) return { priceSom: price, off: 0, base: price, blocked: '' }
  const max = policy?.canGive ? policy.myMaxPercent ?? 100 : 0
  if (off * 100 > d.ref * max) {
    const blocked = !policy?.canGive ? 'скидку оформляет руководитель' : `скидка больше вашего предела (${max} %) — решает руководитель`
    return { priceSom: price, off: 0, base: price, blocked }
  }
  return {
    priceSom: d.ref,
    discount: d.discount.kind === 'percent' ? { percent: d.discount.value } : { som: off },
    off,
    base: d.ref,
    blocked: '',
  }
}

/** 1 500 из 4 000 → «37,5»: проценты скидки суммой — подсказка (считает сервер). */
export function percentText(off: number, base: number): string {
  return (Math.round((off / base) * 1000) / 10).toString().replace('.', ',')
}

/** Цена этапа к оплате: со скидкой — netSom, без — priceSom; без цены — 0. */
export function payable(s: Pick<Step, 'priceSom' | 'netSom'>): number {
  return s.netSom ?? s.priceSom ?? 0
}

/** Итоги этапов: до скидки, скидка, к оплате. */
export function totalsOf(steps: Pick<Step, 'priceSom' | 'netSom' | 'discountSom'>[]): { full: number; off: number; pay: number } {
  const pay = steps.reduce((sum, s) => sum + payable(s), 0)
  const off = steps.reduce((sum, s) => sum + (s.discountSom ?? 0), 0)
  return { full: pay + off, off, pay }
}

/** Неделя и две недели — шаг сроков по умолчанию. */
const FIRST_DAYS = 7
const NEXT_DAYS = 14

/**
 * Срок нового этапа по умолчанию: у этого этапа лечения уже есть срок — тот же; есть сроки у этапов раньше — последний из
 * них + 2 недели; иначе этап 1 — через неделю от сегодня, каждый следующий — ещё +2 недели. Не раньше чем через неделю:
 * в старом плане с прошедшими сроками новый этап не должен родиться просроченным.
 */
export function defaultDue(steps: Pick<Step, 'stage' | 'dueOn' | 'doneAt'>[], stage: number, today: string): string {
  const open = steps.filter((s) => !s.doneAt && s.dueOn)
  const same = open.filter((s) => s.stage === stage).map((s) => s.dueOn as string).sort()
  const earliest = addDays(today, FIRST_DAYS)
  let due: string
  if (same.length > 0) due = same[same.length - 1] as string
  else {
    const before = open.filter((s) => s.stage < stage).map((s) => s.dueOn as string).sort()
    due = before.length > 0 ? addDays(before[before.length - 1] as string, NEXT_DAYS) : addDays(today, FIRST_DAYS + NEXT_DAYS * (stage - 1))
  }
  return due < earliest ? earliest : due
}

/** «81 000 сом, скидка −8 100 сом, к оплате 72 900 сом» — итог этапов; без скидок — «81 000 сом». */
export function totalText(t: { full: number; off: number; pay: number }): string {
  return t.off > 0 ? `${somText(t.full)}, скидка −${somText(t.off)}, к оплате ${somText(t.pay)}` : somText(t.pay)
}
