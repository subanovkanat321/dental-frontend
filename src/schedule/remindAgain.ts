import type { Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { addDays, dateOf, shortDate, timeOf, todayIn } from '../lib/time'

type Appointment = Schemas['AppointmentView']

/**
 * Когда последний раз напоминали: «сегодня в 10:15», «вчера в 10:15» или «12 нояб, 10:15» — по Бишкеку.
 * reminderOpenedAt обновляется при каждой отправке (сервер), поэтому это время последнего напоминания.
 */
export function remindedText(at: string, now = new Date()): string {
  const day = dateOf(at)
  const today = todayIn(now)
  if (day === today) return `сегодня в ${timeOf(at)}`
  if (day === addDays(today, -1)) return `вчера в ${timeOf(at)}`
  return shortDate(at, true)
}

/** Уже напоминали или пациент уже ответил «Приду» — повтор с подтверждением и другим текстом. */
export function isRepeat(a: Appointment): boolean {
  return Boolean(a.reminderOpenedAt) || a.reply === 'CONFIRMED'
}

/**
 * Перед повторным напоминанием — спросить: пациент уже ответил „Приду“ — «Всё равно напомнить?»; уже
 * напоминали — «Уже напоминали в 10:15. Отправить ещё раз?». Первое напоминание — без вопроса (true сразу).
 */
export function confirmRemind(a: Appointment, now = new Date()): Promise<boolean> {
  if (a.reply === 'CONFIRMED') {
    return ask('Пациент уже ответил „Приду“. Всё равно напомнить?', { ok: 'Напомнить' })
  }
  if (a.reminderOpenedAt) {
    const when = remindedText(a.reminderOpenedAt, now).replace(/^сегодня /, '')
    return ask(`Уже напоминали ${when}. Отправить ещё раз?`, { ok: 'Отправить ещё раз' })
  }
  return Promise.resolve(true)
}
