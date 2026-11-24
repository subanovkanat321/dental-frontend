import type { GroupRef, Ready } from './groupsModel'

/**
 * Карточки «кого звать» вкладки «Позвать снова» (2026-11-24: в неё слились «Бросили лечение» и «Группы»).
 * Откуда список карточки:
 * - `board` — список «Позвать снова» (/api/comebacks): «Все», «План отправлен», «Отменили», «Не пришли», «Пора на осмотр»;
 * - `dropped` — «Бросили лечение» (/api/dropped): статус плана, остаток, «Не напоминать», «Отказался»;
 * - `group` — группа пациентов (/api/patient-groups/members): «Не были 6+ месяцев», «Долг», «День рождения», свои группы.
 * «Позвать всех» у любой карточки, кроме «Все», — группа пациентов с тем же правилом ({@link refOfCard}): для карточек
 * списка «Позвать снова» сервер берёт пациентов из того же списка (segment READY CANCELLED, NO_SHOW, RECALL, PLAN_SENT).
 */
export type BoardFilter = 'ALL' | 'SENT' | 'CANCELLED' | 'NO_SHOW' | 'RECALL'
export type CardKey = BoardFilter | 'DROPPED' | 'LAPSED_6' | 'DEBT' | 'BIRTHDAY_MONTH' | `group-${number}`
export type CardSource = 'board' | 'dropped' | 'group'

const BOARD: readonly CardKey[] = ['ALL', 'SENT', 'CANCELLED', 'NO_SHOW', 'RECALL']
const READY_CARDS: readonly CardKey[] = ['LAPSED_6', 'DEBT', 'BIRTHDAY_MONTH']

export function sourceOf(key: CardKey): CardSource {
  if ((BOARD as readonly string[]).includes(key)) return 'board'
  return key === 'DROPPED' ? 'dropped' : 'group'
}

/** Группа пациентов карточки — для «Позвать всех», «Что уже делали» и списка своих групп; у «Все» — нет. */
export function refOfCard(key: CardKey): GroupRef | null {
  if (key === 'ALL') return null
  if (key.startsWith('group-')) return { groupId: Number(key.slice(6)) }
  const ready: Ready = key === 'SENT' ? 'PLAN_SENT' : (key as Ready)
  return { ready }
}

/** Ключ в адресе: #/patients/comeback/<slug> — коротко и без заглавных. */
const SLUGS: Record<string, CardKey> = {
  sent: 'SENT', cancelled: 'CANCELLED', noshow: 'NO_SHOW', recall: 'RECALL', dropped: 'DROPPED',
  lapsed: 'LAPSED_6', debt: 'DEBT', birthday: 'BIRTHDAY_MONTH',
}

export function slugOf(key: CardKey): string | null {
  if (key === 'ALL') return null
  if (key.startsWith('group-')) return key
  return Object.entries(SLUGS).find(([, k]) => k === key)?.[0] ?? null
}

export function keyOfSlug(slug: string | null): CardKey | null {
  if (!slug) return null
  if (/^group-\d{1,12}$/.test(slug)) return slug as CardKey
  return SLUGS[slug] ?? null
}

/** Карточки готовых групп по порядку (после карточек списка «Позвать снова»). */
export const READY_ORDER = READY_CARDS
