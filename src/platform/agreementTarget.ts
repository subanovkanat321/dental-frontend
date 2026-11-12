import type { Schemas } from '../api/client'
import { shortDate } from '../lib/time'

type Channels = Schemas['AgreementsAdminChannels']
type Reminded = Schemas['AgreementRemindersReminded']

/**
 * Кому дойдёт напоминание о договоре: админы клиники по каналам — только счётчики (без номеров и id).
 * «✈️ Telegram 2 · 📱 по номеру 1 · 🔔 push 1»; админов нет — так и сказать.
 */
export function adminsLine(a?: Channels): string {
  const tg = a?.telegram ?? 0
  const phone = a?.phone ?? 0
  const push = a?.push ?? 0
  if (!tg && !phone) return 'руководителей нет'
  return [tg ? `✈️ Telegram ${tg}` : null, phone ? `📱 по номеру ${phone}` : null, push ? `🔔 push ${push}` : null].filter(Boolean).join(' · ')
}

/** Ответ кнопки «Напомнить»: куда дошло. */
export function remindedText(r: Reminded): string {
  const parts = [`в Telegram — ${r.telegram}`, `в приложение — ${r.push}`, `только баннер — ${r.bannerOnly}`]
  const head = r.clinics === 0 ? 'Никому не напомнили' : `Напомнили клиникам: ${r.clinics}. Руководителям ${parts.join(', ')}`
  return (r.skipped ? `${head}. Уже напоминали за сутки — пропущено: ${r.skipped}` : head) + '.'
}

/** Статус договора клиники в списке: какая версия нужна, подписана ли и когда. */
export function statusText(s?: Schemas['AgreementsStatus']): { text: string; tone: string } {
  if (!s?.requiredVersion) return { text: s?.acceptedVersion ? `v${s.acceptedVersion} (история)` : 'не адресован', tone: 'hint' }
  const v = `v${s.requiredVersion}${s.assigned ? ' · назначена' : ''}`
  return s.signed ? { text: `${v} ✓ ${s.signedAt ? shortDate(s.signedAt) : ''}`.trim(), tone: 'tone-ok' }
    : { text: `${v} — не подписан`, tone: 'tone-wait' }
}

export type Audience = { all: boolean; clinicIds: number[] }

/** «всем клиникам» / «клиникам: 3» — для списка версий. */
export function audienceText(v: { forAll?: boolean; clinicIds?: number[] }): string {
  return v.forAll === false ? `выбранным клиникам: ${v.clinicIds?.length ?? 0}` : 'всем клиникам'
}
