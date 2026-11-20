import type { Schemas } from '../api/client'

export type CancelReason = NonNullable<Schemas['AppointmentView']['cancelReason']>

/**
 * Причины отмены и неявки (V235) — слова для карточки, листа выбора и «Аналитики». Пациентам их не показываем.
 * PATIENT ставит сервер сам, когда пациент отменяет в боте или Mini App; сотрудник его не выбирает.
 */
export const REASON_TEXT: Record<CancelReason, string> = {
  CHANGED_MIND: 'Передумал',
  DUPLICATE: 'Дубль записи',
  ILL: 'Заболел',
  OTHER_TIME: 'Перенёс на другое время',
  CLINIC: 'Клиника отменила',
  OTHER: 'Другое',
  PATIENT: 'Пациент отменил сам',
}

/** Что предлагать: у неявки «Клиника отменила» не бывает. */
export const CANCEL_CHOICES: CancelReason[] = ['CHANGED_MIND', 'DUPLICATE', 'ILL', 'OTHER_TIME', 'CLINIC', 'OTHER']
export const NO_SHOW_CHOICES: CancelReason[] = ['CHANGED_MIND', 'ILL', 'OTHER_TIME', 'DUPLICATE', 'OTHER']

/** «Отменён · дубль записи», «Неявка · заболел — уехал в Ош»; причины нет — null. */
export function reasonLine(a: Pick<Schemas['AppointmentView'], 'status' | 'cancelReason' | 'cancelNote'>): string | null {
  if (!a.cancelReason || (a.status !== 'CANCELLED' && a.status !== 'NO_SHOW')) return null
  const word = a.status === 'CANCELLED' ? 'Отменён' : 'Неявка'
  const reason = REASON_TEXT[a.cancelReason].toLowerCase()
  return `${word} · ${reason}${a.cancelNote ? ` — ${a.cancelNote}` : ''}`
}
