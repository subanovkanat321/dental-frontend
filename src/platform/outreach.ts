import type { Schemas } from '../api/client'
import { MOVE_TEMPLATE_PATH } from '../lib/texts'
import { dateOf, todayIn } from '../lib/time'

export type OutreachLead = Schemas['SalesFunnelLead']
export type Group = 'FRESH' | 'SENT' | 'FURTHER' | 'DECLINED'

export const PLACEHOLDER = '{клиника}'

/** Личная ссылка клиники на регистрацию (сервер, V272): /start?k=<код> — форма откроется сразу с этой клиникой. */
export const LINK_PLACEHOLDER = '{ссылка}'

/**
 * Личная ссылка лида: signupUrl (с сервера, https://tish.kg/start) + ?k=<код>. Кода нет (старый сервер, клиника уже
 * подключена) — просто страница регистрации.
 */
export function inviteLink(lead: Pick<OutreachLead, 'inviteToken'>, signupUrl: string): string {
  return lead.inviteToken ? `${signupUrl}?k=${encodeURIComponent(lead.inviteToken)}` : signupUrl
}

/** Группы списка по этапу воронки: не писали, написали, ответили и дальше, отказались. */
export const GROUPS: [Group, string][] = [['FRESH', 'Не писали'], ['SENT', 'Написали'], ['FURTHER', 'Ответили/дальше'], ['DECLINED', 'Отказались']]

export function groupOf(lead: OutreachLead): Group {
  switch (lead.stage) {
    case 'LEAD': return 'FRESH'
    case 'CONTACTED': return 'SENT'
    case 'LOST': return 'DECLINED'
    default: return 'FURTHER'
  }
}

/**
 * Текст сообщения клинике: {ссылка} → её личная ссылка, {клиника} → название (везде, где встретится). Свой текст
 * владельца без {ссылка} уходит как написан (простой tish.kg/start в нём так и остаётся).
 */
export function messageFor(template: string, clinicName: string, link = ''): string {
  // Адрес сайта без https:// (в старом сохранённом тексте) — с https://: так WhatsApp делает его ссылкой
  return template.split(LINK_PLACEHOLDER).join(link).split(PLACEHOLDER).join(clinicName)
    .replace(/(^|[\s(«"])(tish\.kg(?:\/\S*)?)/g, '$1https://$2')
}

/** Пришли по личной ссылке: открыли её (до регистрации) и зарегистрировались ли после этого. */
export function inviteState(lead: OutreachLead): 'registered' | 'opened' | null {
  if (!lead.inviteOpenedAt) return null
  return lead.clinicId != null ? 'registered' : 'opened'
}

/** Кому можно написать: ещё не писали, не просили не беспокоить, есть телефон, Instagram или ссылка. */
export function writable(lead: OutreachLead): boolean {
  return lead.stage === 'LEAD' && Boolean(lead.phone || lead.instagram || lead.link)
}

/** Каким каналом написали клинике (сервер помнит в contactedVia; старые отметки без канала — WhatsApp). */
export type Channel = 'WHATSAPP' | 'INSTAGRAM'

/** Фильтр «Канал»: куда можно написать — есть телефон (WhatsApp), есть Instagram или есть оба. */
export type Reach = 'WHATSAPP' | 'INSTAGRAM' | 'BOTH'

export const REACHES: [Reach, string][] = [['WHATSAPP', 'WhatsApp'], ['INSTAGRAM', 'Instagram'], ['BOTH', 'Есть оба']]

export function reaches(lead: OutreachLead, reach: Reach): boolean {
  return reach === 'WHATSAPP' ? Boolean(lead.phone) : reach === 'INSTAGRAM' ? Boolean(lead.instagram) : Boolean(lead.phone && lead.instagram)
}

/** Куда можно написать — словами, для колонки «Канал»: «WhatsApp», «Instagram», «WhatsApp + Instagram». */
export function reachText(lead: OutreachLead): string {
  return [lead.phone && 'WhatsApp', lead.instagram && 'Instagram'].filter(Boolean).join(' + ')
}

/**
 * Direct этого аккаунта: ig.me/m/<логин> — на телефоне откроется приложение Instagram сразу в чате, на компьютере —
 * instagram.com/direct. Текст по ссылке Instagram не подставляет — его копируем в буфер заранее.
 */
export function instagramUrl(login: string): string {
  return `https://ig.me/m/${encodeURIComponent(login)}`
}

/** Профиль клиники в Instagram — посмотреть, что за клиника. */
export function instagramProfile(login: string): string {
  return `https://www.instagram.com/${encodeURIComponent(login)}/`
}

/**
 * «Следующая клиника»: первая неписаная после текущей по порядку списка (как загружали), а с конца —
 * снова сначала. Текущая ушла из списка (её отметили, фильтр «Не писали») — первая неписаная.
 */
export function nextLead(leads: OutreachLead[], currentId: number | null): OutreachLead | null {
  const candidates = leads.filter(writable)
  if (!candidates.length) return null
  const from = currentId == null ? -1 : leads.findIndex((l) => l.id === currentId)
  if (from < 0) return candidates[0]!
  return leads.slice(from + 1).find(writable) ?? candidates.find((l) => l.id !== currentId) ?? null
}

/**
 * Пора «🔁 Напомнить»: написали (этап «Связались»), молчат days+ календарных дней по Бишкеку и ещё не
 * напоминали — напоминание одно (remindedAt ставит сервер).
 */
export function remindDue(lead: OutreachLead, days: number, now = new Date()): boolean {
  if (lead.stage !== 'CONTACTED' || !lead.contactedAt || lead.remindedAt) return false
  const passed = (Date.parse(`${todayIn(now)}T00:00:00Z`) - Date.parse(`${dateOf(lead.contactedAt)}T00:00:00Z`)) / 86400000
  return passed >= days
}

/** Открытая ссылка на шаблон переезда — для сообщений клиникам и инструкций. */
export function templateUrl(origin: string = window.location.origin): string {
  return `${origin}${MOVE_TEMPLATE_PATH}`
}

/** Третье сообщение клинике — после текста №2: шаблон, который мы перенесём за неё. */
export function templateMessage(origin?: string): string {
  return `Вот шаблон — заполните, и мы всё перенесём: ${templateUrl(origin)}\n`
    + 'Пациенты, прайс, врачи, склад, будущие записи и долги — каждое на своём листе. Пустые листы можно не трогать.'
}
