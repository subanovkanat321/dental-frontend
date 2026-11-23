import type { Schemas } from '../api/client'
import { REASON_TEXT, type CancelReason } from '../schedule/cancelReasons'
import { plural } from '../lib/plural'
import { shortDate, somText } from '../lib/time'

export type TimelineItem = Schemas['PatientTimelineItem']
export type TimelineKind = TimelineItem['kind']

/** Как ушло сообщение — коротко, после «·». Неизвестный канал — без подписи. */
const CHANNEL: Record<string, string> = {
  BOT: 'в бот',
  TELEGRAM: 'в бот',
  WHATSAPP: 'в WhatsApp',
  SMS: 'по SMS',
  MINI_APP: 'в Mini App',
  SITE: 'на сайте',
  LINK: 'по ссылке',
  PAGE: 'по ссылке',
}

/** Обращение до записи (шаг 8Б): откуда и что с ним — те же слова, что в «Пациенты → Обращения». */
const LEAD_CHANNEL: Record<string, string> = {
  CALL: 'звонок', WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', TELEGRAM: 'Telegram', SITE: 'сайт', WALK_IN: 'пришёл сам',
  RECOMMENDATION: 'по рекомендации', OTHER: 'другое',
}
const LEAD_STATUS: Record<string, string> = {
  NEW: 'новое', NO_ANSWER: 'не дозвонились', THINKING: 'думает', BOOKED: 'записан', REFUSED: 'отказался',
}

const METHOD: Record<string, string> = {
  CASH: 'наличные',
  CARD: 'карта',
  TRANSFER: 'перевод',
  ADVANCE: 'с аванса',
}

/** Значок строки — один на вид события: глаз находит оплаты, отмены и приёмы без чтения. */
export const TIMELINE_ICON: Record<TimelineKind, string> = {
  CREATED: '🆕',
  BOOKED: '📅',
  REQUESTED: '📲',
  DONE: '✅',
  NO_SHOW: '🚫',
  CANCELLED: '❌',
  REMINDED: '🔔',
  REMINDED_SOON: '⏰',
  REVIEW_ASKED: '💬',
  RATED: '⭐',
  REVIEW_LINK: '🔗',
  REVIEW_CLICKED: '👆',
  REPORT_SENT: '📝',
  PAYMENT: '💵',
  DEPOSIT: '💵',
  ADVANCE_IN: '💰',
  ADVANCE_REFUND: '↩️',
  ADVANCE_TRANSFER: '🔁',
  OPENING_DEBT: '🧾',
  OPENING_DEBT_PAID: '🧾',
  DEBT_REMINDED: '🧾',
  WAITLIST_ADDED: '⏳',
  WAITLIST_OFFERED: '⏳',
  WAITLIST_DECLINED: '⏳',
  PLAN_STEPS: '🦷',
  PLAN_SENT: '📤',
  PLAN_AGREED: '👍',
  PLAN_ACCEPTED: '👍',
  PLAN_VARIANT_ADDED: '⧉',
  PLAN_VARIANT_CHOSEN: '✅',
  PLAN_REFUSED: '👎',
  BOT_INVITED: '📲',
  BOT_JOINED: '🤖',
  BIRTHDAY: '🎂',
  TASK_CREATED: '📌',
  TASK_DONE: '☑️',
  COMEBACK_INVITED: '🔁',
  QUESTION: '❓',
  MERGED: '🔗',
  LEAD: '☎️',
  GROUP_MESSAGE: '👥',
  GROUP_OPT_OUT: '🔕',
}

/** Как выбрал вариант плана (V254). */
const CHOSEN_VIA: Record<string, string> = { STAFF: ' (отметил сотрудник)', BOT: ' в боте', APP: ' в приложении', PAGE: ' по ссылке' }

const via = (channel?: string | null) => (channel && CHANNEL[channel] ? ` ${CHANNEL[channel]}` : '')
const when = (at?: string | null) => (at ? shortDate(at, true) : '')

/** Главная строка события: «Записали на 25 нояб, 14:00», «Оплата 3 000 сом · наличные». Без медицинского. */
export function timelineText(i: TimelineItem): string {
  switch (i.kind) {
    case 'CREATED': return 'Завели карточку'
    case 'BOOKED': return `Записали на ${when(i.appointmentAt)}${i.previousAt ? ` · перенесли с ${when(i.previousAt)}` : ''}`
    case 'REQUESTED': return `Записался сам${via(i.detail)} на ${when(i.appointmentAt)}${i.previousAt ? ` · перенесли с ${when(i.previousAt)}` : ''}`
    case 'DONE': return 'Приём состоялся'
    case 'NO_SHOW': return `Не пришёл на приём ${when(i.appointmentAt)}`
    case 'CANCELLED': {
      const reason = i.extra && i.extra !== 'PATIENT' && i.extra in REASON_TEXT ? ` · ${REASON_TEXT[i.extra as CancelReason].toLowerCase()}` : ''
      return `${i.byPatient ? 'Пациент отменил' : 'Отменили'} запись на ${when(i.appointmentAt)}${reason}`
    }
    case 'REMINDED': return `Напомнили о приёме ${when(i.appointmentAt)}`
    case 'REMINDED_SOON': return 'Бот напомнил перед приёмом'
    case 'REVIEW_ASKED': return 'Бот попросил оценить приём'
    case 'RATED': return `Оценил приём: ${'★'.repeat(Math.max(0, Math.min(5, i.count ?? 0)))}`
    case 'REVIEW_LINK': return 'Отправили ссылку на отзыв'
    case 'REVIEW_CLICKED': return 'Перешёл по ссылке отзыва'
    case 'REPORT_SENT': return `Отправили сообщение после приёма${via(i.detail)}`
    case 'PAYMENT': return `Оплата ${somText(i.amountSom ?? 0)}${i.detail && METHOD[i.detail] ? ` · ${METHOD[i.detail]}` : ''}${i.extra === 'BOT' ? ' · в боте' : ''}`
    case 'DEPOSIT': return `Предоплата ${somText(i.amountSom ?? 0)}${i.detail && METHOD[i.detail] ? ` · ${METHOD[i.detail]}` : ''}`
    case 'ADVANCE_IN': return `Внесли аванс ${somText(i.amountSom ?? 0)}`
    case 'ADVANCE_REFUND': return `Вернули аванс ${somText(i.amountSom ?? 0)}`
    case 'ADVANCE_TRANSFER': return `Аванс в семье: ${(i.amountSom ?? 0) > 0 ? '+' : '−'}${somText(Math.abs(i.amountSom ?? 0))}`
    case 'OPENING_DEBT': return `Долг до Tish ${somText(i.amountSom ?? 0)}`
    case 'OPENING_DEBT_PAID': return `Оплатил долг до Tish ${somText(i.amountSom ?? 0)}`
    case 'DEBT_REMINDED': return `Напомнили о долге${via(i.detail)}`
    case 'WAITLIST_ADDED': return 'Добавили в лист ожидания'
    case 'WAITLIST_OFFERED': return `Предложили окно ${when(i.appointmentAt)}${via(i.detail)}`
    case 'WAITLIST_DECLINED': return `Отказался от окна ${when(i.appointmentAt)}`
    case 'PLAN_STEPS': {
      const n = i.count ?? 0
      return `План лечения: ${n} ${plural(n, 'новый шаг', 'новых шага', 'новых шагов')}`
    }
    case 'PLAN_SENT': return `Отправили план пациенту${via(i.detail)}`
    case 'PLAN_AGREED': return 'Согласился с планом по ссылке'
    case 'PLAN_ACCEPTED': return 'План принят'
    case 'PLAN_VARIANT_ADDED': return `Добавлен вариант плана: Вариант ${i.count ?? ''}${i.extra ? ` — ${i.extra}` : ''}`
    case 'PLAN_VARIANT_CHOSEN': return `Пациент выбрал вариант ${i.count ?? ''}${i.extra ? ` — ${i.extra}` : ''}${CHOSEN_VIA[i.detail ?? ''] ?? ''}`
    case 'PLAN_REFUSED': return 'Отказался от плана'
    case 'BOT_INVITED': return `Пригласили в бот${via(i.detail)}`
    case 'BOT_JOINED': return 'Подключился к боту'
    case 'BIRTHDAY': return `Поздравили с днём рождения${via(i.detail)}`
    case 'TASK_CREATED': return `Задача: ${i.extra ?? ''}`
    case 'TASK_DONE': return `Задача выполнена: ${i.extra ?? ''}`
    case 'COMEBACK_INVITED': return `Позвали снова${via(i.detail)}`
    case 'QUESTION': return 'Задал вопрос в боте'
    case 'MERGED': return `Объединили с карточкой «${i.extra ?? ''}»`
    case 'GROUP_MESSAGE': return `Сообщение группы «${i.extra ?? ''}»${via(i.detail)}`
    case 'GROUP_OPT_OUT': return 'Попросил не присылать сообщения групп'
    case 'LEAD': return `Обращение${i.detail && LEAD_CHANNEL[i.detail] ? ` · ${LEAD_CHANNEL[i.detail]}` : ''}: ${LEAD_STATUS[i.extra ?? ''] ?? 'изменилось'}`
  }
}

/** Серая строка под событием: услуга и врач (для приёмов и листа ожидания). */
export function timelineSub(i: TimelineItem): string {
  return [i.service, i.doctor].filter(Boolean).join(' · ')
}

/** Кто сделал: сотрудник, «пациент» или «бот» (поздравил сам); не знаем — пусто. */
export function timelineWho(i: TimelineItem): string {
  if (i.byPatient) return 'пациент'
  if (i.who) return i.who
  if (i.kind === 'BIRTHDAY' || i.kind === 'REMINDED_SOON' || i.kind === 'REVIEW_ASKED') return 'бот'
  return ''
}

/** Ключ дня по Бишкеку — для заголовков «21 нояб 2026» в ленте. */
export function timelineDay(at: string): string {
  return shortDate(at)
}
