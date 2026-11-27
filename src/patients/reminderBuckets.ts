import type { Schemas } from '../api/client'
import { contactPhone } from '../lib/guardian'

type Appointment = Schemas['AppointmentView']

/**
 * Обзвон на сегодня и завтра («Пациенты → Записаны»): кто в каком положении. Только запланированные — заявку
 * сначала подтверждают, ей напоминать рано.
 * - confirmed — «Подтвердили»: пациент ответил «приду» (reply CONFIRMED);
 * - reminded — «Напомнили»: напоминание ушло (бот, WhatsApp — reminderOpenedAt; бот за 2 часа — soonRemindedAt)
 *   или пациент ответил иначе (перенести, нет ответа), а «приду» нет — то же «Напомнили: X из Y», что в «Дне»;
 * - todo — «Не напомнили»: ещё ничего, а написать есть куда (номер — свой или представителя — или бот);
 * - nowhere — «Нет контакта»: ни номера, ни бота — только позвонить с карточки или добавить номер.
 */
export type Bucket = 'confirmed' | 'reminded' | 'todo' | 'nowhere'

export const BUCKETS: readonly (readonly [Bucket, string])[] = [
  ['reminded', 'Напомнили'], ['todo', 'Не напомнили'], ['nowhere', 'Нет контакта'], ['confirmed', 'Подтвердили'],
]

export function bucketOf(a: Appointment): Bucket | null {
  if (a.status !== 'SCHEDULED') return null
  if (a.reply === 'CONFIRMED') return 'confirmed'
  if (a.reminderOpenedAt || a.soonRemindedAt || (a.reply && a.reply !== 'NONE')) return 'reminded'
  return contactPhone(a.patient) || a.patient.telegram ? 'todo' : 'nowhere'
}

export function bucketCounts(list: Appointment[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { confirmed: 0, reminded: 0, todo: 0, nowhere: 0 }
  for (const a of list) {
    const b = bucketOf(a)
    if (b) counts[b]++
  }
  return counts
}

/** Выполнить задачи не больше {@code limit} одновременно (не забить сервер десятками запросов разом); сколько не удалось. */
export async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<unknown>): Promise<number> {
  let next = 0
  let failed = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!
      try { await task(item) } catch { failed++ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return failed
}
