import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { draftSomAt, fitsPolicy } from '../patients/birthdayGift'
import type { DiscountDraft } from '../schedule/discountDraft'

export type ReferralSettings = Schemas['PatientReferralsSettingsView']
export type ReferralOffer = Schemas['PatientReferralsOffer']
export type ReferralCard = Schemas['PatientReferralsCard']
type Appointment = Schemas['AppointmentView']
type Policy = Schemas['DiscountPoliciesPolicy']

export const REFERRAL_SETTINGS_KEY = ['referral-settings']

/** Ключ «Приведи друга» в карточке пациента. */
export function referralKey(patientId: number) {
  return ['referral-card', patientId]
}

/** Комментарии скидки — как на сервере (PatientReferrals): по ним бонус отмечается использованным. */
export const FRIEND_COMMENT = 'Приведи друга: скидка новому пациенту'
export const REWARD_COMMENT = 'Приведи друга: бонус за друга'

/** Настройки «Приведи друга» клиники — читают все (карточка и оплата решают, что показать), меняет руководитель. */
export function useReferralSettings(enabled = true) {
  return useQuery({
    queryKey: REFERRAL_SETTINGS_KEY,
    queryFn: () => unwrap(api.GET('/api/clinic/referral-settings')),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Цена строки услуги приёма (с её скидкой, за одну услугу) — для бонуса «услуга бесплатно». */
function serviceLinePrice(a: Appointment, serviceId?: number | null): { name: string; priceSom: number } | null {
  if (serviceId == null) return null
  const line = (a.services ?? []).find((l) => l.serviceTypeId === serviceId)
  if (line) {
    const price = line.discountSom && line.netSom != null && line.qty > 0 ? Math.round(line.netSom / line.qty)
      : line.priceSom ?? (line.amountSom != null && line.qty > 0 ? Math.round(line.amountSom / line.qty) : undefined)
    return price ? { name: line.name, priceSom: price } : null
  }
  return null
}

/**
 * Подсказка «Приведи друга» для этой оплаты: что написать и что подставить в скидку.
 * - what — «🎁 Пришёл по приглашению — скидка 10 %» / «🎁 Бонус за друга (Бакыт) — скидка 10 %»;
 * - draft — скидка с причиной «Акция» и комментарием «Приведи друга: …»; null — подставить нечего (услуги в приёме нет);
 * - why — почему не подставляем.
 */
export type ReferralHint = { key: 'FRIEND' | 'REWARD'; what: string; short: string; draft: DiscountDraft | null; why?: string; usedHere: boolean }

export function referralHint(o: ReferralOffer, a: Appointment): ReferralHint {
  const comment = o.kind === 'FRIEND' ? FRIEND_COMMENT : REWARD_COMMENT
  const more = o.kind === 'REWARD' && o.count > 1 ? ` · бонусов: ${o.count}` : ''
  const what = o.kind === 'FRIEND'
    ? `🎁 Пришёл по приглашению — ${o.bonus.label}`
    : `🎁 Бонус за друга${o.friendName ? ` (${o.friendName})` : ''} — ${o.bonus.label}${more}`
  const short = o.kind === 'FRIEND' ? 'по приглашению' : 'бонус за друга'
  if (o.bonus.kind === 'PERCENT' && o.bonus.percent) {
    return { key: o.kind, what, short, usedHere: o.usedHere, draft: { kind: 'percent', value: String(o.bonus.percent), reason: 'PROMO', comment } }
  }
  const line = serviceLinePrice(a, o.bonus.serviceId)
  return line
    ? { key: o.kind, what, short, usedHere: o.usedHere, draft: { kind: 'som', value: String(line.priceSom), reason: 'PROMO', comment } }
    : { key: o.kind, what, short, usedHere: o.usedHere, draft: null,
      why: o.bonus.serviceName ? `в приёме нет услуги «${o.bonus.serviceName}» — добавьте её, и скидка подставится` : 'скидку впишите сами' }
}

/**
 * Подсказки «Приведи друга» в оплате приёма (2026-11-24): запрос — только когда программа включена или у пациента могут
 * быть бонусы (сервер отдаёт заработанные бонусы и при выключенной программе). ready — ответ пришёл (или не нужен).
 */
export function useReferralOffers(a: Appointment): { hints: ReferralHint[]; ready: boolean } {
  const offers = useQuery({
    queryKey: ['referral-offers', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/referral-offers', { params: { path: { id: a.id } } })),
    staleTime: 60_000,
    retry: false,
  })
  return { hints: (offers.data ?? []).map((o) => referralHint(o, a)), ready: !offers.isPending }
}

/** Кандидат на скидку в оплате: подарок, метка, «Приведи друга» — с подписью для строки «Скидки не складываются». */
export type Candidate = { label: string; draft: DiscountDraft | null }

/**
 * Скидки не складываются: из всех подсказок — бо́льшая в сомах, которую сотруднику можно дать (поровну — первая по порядку).
 * null — подставлять нечего.
 */
export function biggestCandidate(list: Candidate[], price: number | null, policy?: Policy): Candidate | null {
  let best: Candidate | null = null
  for (const c of list) {
    if (!c.draft || !fitsPolicy(c.draft, price, policy)) continue
    if (!best || draftSomAt(price, c.draft) > draftSomAt(price, best.draft)) best = c
  }
  return best
}

/** «📤 Поделиться» в WhatsApp: номер пациента (без «+») и готовый текст. */
export function whatsAppUrl(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
