import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { addDays, dateOf } from '../lib/time'
import type { DiscountDraft } from '../schedule/discountDraft'

export type Gift = Schemas['BirthdaysGift']
export type GiftPreset = Gift['preset']
type Appointment = Schemas['AppointmentView']
type Policy = Schemas['DiscountPoliciesPolicy']

export const GIFT_KEY = ['birthday-gift']

/** Подарок на день рождения клиники (с образцом поздравления) — читают все, меняет руководитель. */
export function useBirthdayGift(enabled = true) {
  return useQuery({ queryKey: GIFT_KEY, queryFn: () => unwrap(api.GET('/api/clinic/birthday-gift')), enabled, staleTime: 5 * 60_000 })
}

/** Подарок действует: день рождения был в последние 30 дней или будет в ближайшие 7 (от даты приёма). */
export const GIFT_DAYS_AFTER = 30
export const GIFT_DAYS_BEFORE = 7

/** День рождения в этом году: 29 февраля в невисокосный год — 28-го (как на сервере). */
function birthdayIn(year: number, birthDate: string): string {
  const [, m, d] = birthDate.split('-')
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const day = m === '02' && d === '29' && !leap ? '28' : d
  return `${year}-${m}-${day}`
}

/** Дата приёма (ГГГГ-ММ-ДД) попадает в срок подарка от дня рождения — в прошлом, этом или следующем году. */
export function inGiftWindow(birthDate: string | undefined | null, date: string): boolean {
  if (!birthDate) return false
  const year = Number(date.slice(0, 4))
  return [year - 1, year, year + 1].some((y) => {
    const bday = birthdayIn(y, birthDate)
    return date >= addDays(bday, -GIFT_DAYS_BEFORE) && date <= addDays(bday, GIFT_DAYS_AFTER)
  })
}

/** Строка услуги «профчистка»: выбранная в настройках подарка, иначе по названию («чистк», «гигиен»). */
const CLEANING = /чистк|гигиен/i

export type CleaningLine = { name: string; priceSom: number }

export function cleaningLine(a: Appointment, serviceId?: number | null): CleaningLine | null {
  const lines: { serviceTypeId?: number; name: string; priceSom?: number }[] = (a.services ?? []).map((l) => ({
    serviceTypeId: l.serviceTypeId, name: l.name,
    // Строку уже удешевили (скидка строки, V258) — дарим то, что за одну чистку осталось заплатить
    priceSom: l.discountSom && l.netSom != null && l.qty > 0 ? Math.round(l.netSom / l.qty)
      : l.priceSom ?? (l.amountSom != null && l.qty > 0 ? Math.round(l.amountSom / l.qty) : undefined),
  }))
  // Приём без строк — одна услуга приёма
  if (!lines.length && a.serviceName) lines.push({ name: a.serviceName, priceSom: a.servicePriceSom })
  const found = (serviceId != null ? lines.find((l) => l.serviceTypeId === serviceId) : undefined)
    ?? lines.find((l) => CLEANING.test(l.name))
  return found?.priceSom ? { name: found.name, priceSom: found.priceSom } : null
}

/**
 * Подарок для этой оплаты.
 * - draft — что подставить в скидку (причина «Акция», комментарий «Подарок на день рождения…»); null — подставить нечего
 *   (профчистки в приёме нет, у своего промокода скидка только словами) — тогда только подсказка;
 * - what — «скидка 10 %» / «бесплатная профчистка»; why — почему не подставляем.
 */
export type GiftOffer = { what: string; code?: string; draft: DiscountDraft | null; why?: string }

export function giftOffer(gift: Gift | undefined, a: Appointment): GiftOffer | null {
  if (!gift?.active || !inGiftWindow(a.patient?.birthDate, dateOf(a.startAt))) return null
  const code = gift.code
  if (gift.preset === 'CLEANING') {
    const line = cleaningLine(a, gift.serviceId)
    return line
      ? { what: 'бесплатная профчистка', code, draft: { kind: 'som', value: String(line.priceSom), reason: 'PROMO', comment: 'Подарок на день рождения: профчистка' } }
      : { what: 'бесплатная профчистка', code, draft: null, why: 'в приёме нет услуги чистки — добавьте её, и скидка подставится' }
  }
  if (gift.discountPercent) {
    return { what: `скидка ${gift.discountPercent} %`, code, draft: { kind: 'percent', value: String(gift.discountPercent), reason: 'PROMO', comment: `Подарок на день рождения (${code})` } }
  }
  return { what: gift.label ?? `промокод ${code}`, code, draft: null, why: 'скидку впишите сами' }
}

/** Скидка в сомах при этой цене — чтобы сравнить подарок и скидку по метке. */
export function draftSomAt(price: number | null, d: DiscountDraft | null): number {
  if (!d || price == null || price <= 0) return 0
  const v = Number(d.value)
  return d.kind === 'percent' ? Math.round((price * v) / 100) : Math.min(v, price)
}

/** Подходит под «Настройки → Пациенты и скидки → Скидки»: давать можно и не больше моего предела. */
export function fitsPolicy(d: DiscountDraft | null, price: number | null, policy?: Policy): boolean {
  if (!d || !policy?.canGive) return false
  const max = policy.myMaxPercent ?? 100
  if (d.kind === 'percent') return Number(d.value) <= max
  return price != null && price > 0 && Number(d.value) * 100 <= price * max
}

/** Скидки не складываются: из подарка и метки — бо́льшая в сомах (поровну — подарок). */
export function biggerDraft(gift: DiscountDraft | null, tag: DiscountDraft | null, price: number | null): 'gift' | 'tag' | null {
  if (!gift) return tag ? 'tag' : null
  if (!tag) return 'gift'
  return draftSomAt(price, tag) > draftSomAt(price, gift) ? 'tag' : 'gift'
}

/** В форме стоит именно эта скидка (и с тем же комментарием: «Подарок…» и «Приведи друга…» — разные подсказки). */
export function sameDraft(a: DiscountDraft | null, b: DiscountDraft | null): boolean {
  return a != null && b != null && a.kind === b.kind && a.value === b.value && a.reason === b.reason && a.comment.trim() === b.comment.trim()
}

/**
 * Подарок на день рождения в оплате (2026-11-24): у пациента день рождения был в последние 30 дней (или будет через неделю),
 * клиника выбрала подарок — что подставить в скидку. ready — подарок загрузился (или не нужен): форма решает, что подставить
 * один раз, когда всё известно. Запрос — только имениннику.
 */
export function useBirthdayOffer(a: Appointment): { offer: GiftOffer | null; ready: boolean } {
  const needed = inGiftWindow(a.patient?.birthDate, dateOf(a.startAt))
  const gift = useBirthdayGift(needed)
  return { offer: needed ? giftOffer(gift.data, a) : null, ready: !needed || !gift.isPending }
}

/**
 * Что подставить в новую оплату: подарок или скидку по метке — бо́льшую (скидки не складываются) и только ту, что сотруднику
 * можно дать. null — ничего.
 */
export function prefillDraft(gift: GiftOffer | null, tag: DiscountDraft | null, price: number | null, policy?: Policy): DiscountDraft | null {
  const g = gift?.draft && fitsPolicy(gift.draft, price, policy) ? gift.draft : null
  const t = tag && fitsPolicy(tag, price, policy) ? tag : null
  const which = biggerDraft(g, t, price)
  return which === 'gift' ? g : which === 'tag' ? t : null
}
