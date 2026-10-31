import type { Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

export type Tone = 'ok' | 'wait' | 'bad' | 'hint'

/** Подпись приёма — как строка «Дня» в Mini App (state.js rowState), без кнопок. */
export function statusOf(a: Appointment, now = new Date()): { label: string; icon: string; tone: Tone } {
  if (a.status === 'CANCELLED') return { label: 'Отменён', icon: '❌', tone: 'hint' }
  if (a.status === 'DONE' && a.chargeSom != null && a.paidSom == null) return { label: 'Ждёт оплаты на кассе', icon: '💳', tone: 'wait' }
  if (a.status === 'DONE') return { label: 'Приём состоялся', icon: '✅', tone: 'ok' }
  if (a.status === 'NO_SHOW') return { label: 'Неявка', icon: '🚷', tone: 'bad' }
  if (a.status === 'REQUESTED') return { label: 'Заявка — подтвердите', icon: '🆕', tone: 'wait' }
  if (a.endAt && new Date(a.endAt) < now) return { label: 'Отметьте: явка или неявка?', icon: '❓', tone: 'wait' }
  if (a.reply === 'CONFIRMED') return { label: 'Придёт', icon: '👍', tone: 'ok' }
  if (a.reply === 'RESCHEDULE') return { label: 'Перенос', icon: '🔄', tone: 'wait' }
  if (a.reply === 'NO_ANSWER') return { label: 'Нет ответа', icon: '📵', tone: 'wait' }
  if (a.reminderOpenedAt) return { label: 'Ждём ответа', icon: '⏳', tone: 'wait' }
  return { label: 'Не напомнили', icon: '🔔', tone: 'hint' }
}
