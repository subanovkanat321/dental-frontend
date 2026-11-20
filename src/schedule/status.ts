import type { Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

type Tone = 'ok' | 'wait' | 'bad' | 'hint'

/**
 * Вид статуса — заливка блока и чипа (DESIGN.md → Colors): заявка синяя, ждём ответа янтарная,
 * подтвердил зелёная, пришёл бирюзовая (в клинике сейчас), в кресле сиреневая (приём идёт), состоялся серая,
 * ждёт оплаты на кассе персиковая, неявка красная.
 */
export type Kind = 'request' | 'wait' | 'ok' | 'here' | 'chair' | 'done' | 'cashier' | 'bad' | 'quiet'

type Status = { label: string; icon: string; tone: Tone; kind: Kind }

/** Подпись приёма — как строка «Дня» в Mini App (state.js rowState), без кнопок. */
export function statusOf(a: Appointment, now = new Date()): Status {
  if (a.status === 'CANCELLED') return { label: 'Отменён', icon: '❌', tone: 'hint', kind: 'quiet' }
  if (a.status === 'DONE' && a.chargeSom != null && a.paidSom == null) return { label: 'Ждёт оплаты на кассе', icon: '💳', tone: 'wait', kind: 'cashier' }
  if (a.status === 'DONE') return { label: 'Приём состоялся', icon: '✅', tone: 'ok', kind: 'done' }
  if (a.status === 'NO_SHOW') return { label: 'Неявка', icon: '🚷', tone: 'bad', kind: 'bad' }
  if (a.status === 'REQUESTED') return { label: 'Заявка — подтвердите', icon: '🆕', tone: 'wait', kind: 'request' }
  if (a.inChairAt) return { label: CARD_STATUS.chair.label, icon: CARD_STATUS.chair.icon, tone: 'ok', kind: 'chair' }
  if (a.arrivedAt) return { label: CARD_STATUS.arrived.label, icon: CARD_STATUS.arrived.icon, tone: 'ok', kind: 'here' }
  if (a.endAt && new Date(a.endAt) < now) return { label: 'Отметьте: явка или неявка?', icon: '❓', tone: 'wait', kind: 'wait' }
  if (a.reply === 'CONFIRMED') return { label: CARD_STATUS.confirmed.label, icon: CARD_STATUS.confirmed.icon, tone: 'ok', kind: 'ok' }
  if (a.reply === 'RESCHEDULE') return { label: CARD_STATUS.reschedule.label, icon: CARD_STATUS.reschedule.icon, tone: 'wait', kind: 'wait' }
  if (a.reply === 'NO_ANSWER') return { label: CARD_STATUS.noanswer.label, icon: CARD_STATUS.noanswer.icon, tone: 'wait', kind: 'wait' }
  if (a.reminderOpenedAt) return { label: 'Ждём ответа', icon: '⏳', tone: 'wait', kind: 'wait' }
  return { label: 'Не напомнили', icon: '🔔', tone: 'hint', kind: 'quiet' }
}

/**
 * Статус приёма в карточке — пилюля «🟢 Пришёл ▾» (2026-11-19): одни и те же слова в карточке, сетке и руководстве.
 * На сервере это статус (REQUESTED…NO_SHOW), ответ пациента reply и две отметки у запланированного: «Пришёл» — arrivedAt
 * (V234), «В кресле» — inChairAt (V235, приём начался). Ответ пациента (2026-11-20, вместо отдельного ряда «Подтвердил /
 * Перенос / Нет ответа»): «Подтвердил» — CONFIRMED, «Просит перенести» — RESCHEDULE, «Нет ответа» — NO_ANSWER; «Записан» — NONE.
 */
export type CardStatus = 'request' | 'scheduled' | 'confirmed' | 'reschedule' | 'noanswer' | 'arrived' | 'chair' | 'done' | 'noshow' | 'cancelled'

export const CARD_STATUS: Record<CardStatus, { label: string; menu: string; icon: string; kind: Kind }> = {
  request: { label: 'Заявка', menu: 'Заявка', icon: '🆕', kind: 'request' },
  scheduled: { label: 'Записан', menu: 'Записан', icon: '📅', kind: 'quiet' },
  confirmed: { label: 'Подтвердил', menu: 'Подтвердил (придёт)', icon: '👍', kind: 'ok' },
  reschedule: { label: 'Просит перенести', menu: 'Просит перенести', icon: '🔁', kind: 'wait' },
  noanswer: { label: 'Нет ответа', menu: 'Нет ответа', icon: '📵', kind: 'wait' },
  arrived: { label: 'Пришёл', menu: 'Пришёл', icon: '🟢', kind: 'here' },
  chair: { label: 'В кресле', menu: 'В кресле', icon: '💺', kind: 'chair' },
  done: { label: 'Приём состоялся', menu: 'Приём состоялся', icon: '✅', kind: 'done' },
  noshow: { label: 'Неявка', menu: 'Неявка', icon: '🚷', kind: 'bad' },
  cancelled: { label: 'Отменён', menu: 'Отменён', icon: '❌', kind: 'quiet' },
}

export const CARD_ORDER: CardStatus[] = ['request', 'scheduled', 'confirmed', 'reschedule', 'noanswer', 'arrived', 'chair', 'done', 'noshow', 'cancelled']

export function cardStatusOf(a: Appointment): CardStatus {
  switch (a.status) {
    case 'REQUESTED': return 'request'
    case 'DONE': return 'done'
    case 'NO_SHOW': return 'noshow'
    case 'CANCELLED': return 'cancelled'
    default: return a.inChairAt ? 'chair' : a.arrivedAt ? 'arrived' : a.reply === 'CONFIRMED' ? 'confirmed'
      : a.reply === 'RESCHEDULE' ? 'reschedule' : a.reply === 'NO_ANSWER' ? 'noanswer' : 'scheduled'
  }
}
