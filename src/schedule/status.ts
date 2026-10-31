import type { Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

export type Tone = 'ok' | 'wait' | 'bad' | 'hint'

/**
 * Вид статуса — заливка блока и чипа (DESIGN.md → Colors): заявка синяя, ждём ответа янтарная,
 * придёт зелёная, состоялся серая, ждёт оплаты на кассе персиковая, неявка красная.
 */
export type Kind = 'request' | 'wait' | 'ok' | 'done' | 'cashier' | 'bad' | 'quiet'

export type Status = { label: string; icon: string; tone: Tone; kind: Kind }

/** Подпись приёма — как строка «Дня» в Mini App (state.js rowState), без кнопок. */
export function statusOf(a: Appointment, now = new Date()): Status {
  if (a.status === 'CANCELLED') return { label: 'Отменён', icon: '❌', tone: 'hint', kind: 'quiet' }
  if (a.status === 'DONE' && a.chargeSom != null && a.paidSom == null) return { label: 'Ждёт оплаты на кассе', icon: '💳', tone: 'wait', kind: 'cashier' }
  if (a.status === 'DONE') return { label: 'Приём состоялся', icon: '✅', tone: 'ok', kind: 'done' }
  if (a.status === 'NO_SHOW') return { label: 'Неявка', icon: '🚷', tone: 'bad', kind: 'bad' }
  if (a.status === 'REQUESTED') return { label: 'Заявка — подтвердите', icon: '🆕', tone: 'wait', kind: 'request' }
  if (a.endAt && new Date(a.endAt) < now) return { label: 'Отметьте: явка или неявка?', icon: '❓', tone: 'wait', kind: 'wait' }
  if (a.reply === 'CONFIRMED') return { label: 'Придёт', icon: '👍', tone: 'ok', kind: 'ok' }
  if (a.reply === 'RESCHEDULE') return { label: 'Перенос', icon: '🔄', tone: 'wait', kind: 'wait' }
  if (a.reply === 'NO_ANSWER') return { label: 'Нет ответа', icon: '📵', tone: 'wait', kind: 'wait' }
  if (a.reminderOpenedAt) return { label: 'Ждём ответа', icon: '⏳', tone: 'wait', kind: 'wait' }
  return { label: 'Не напомнили', icon: '🔔', tone: 'hint', kind: 'quiet' }
}
