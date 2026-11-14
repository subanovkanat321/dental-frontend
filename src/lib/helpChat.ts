import { useSyncExternalStore } from 'react'

/**
 * «💬 Спросить помощника» — один чат на всё приложение: окно у правого нижнего края (Shell,
 * `.help-float`), поверх любого экрана. Его открывают меню «Помощь», круглая кнопка на телефоне,
 * «Написать в Tish», «Памятка» и переписки с помощником из списка обращений — все через это
 * хранилище. Раньше «Техподдержка» рисовала тот же чат своей боковой панелью: открытый сразу по
 * адресу (#/help/chat, кнопка бота) он вставал под страницу высотой 38px.
 *
 * Хранилище, а не событие окна: по ссылке #/help/chat страница и Shell появляются одним кадром, и
 * эффект страницы срабатывает раньше, чем Shell успел бы подписаться, — событие потерялось бы.
 */

/** Что открыто: переписка `ticketId` или новый вопрос; null — чат закрыт. */
export type HelpChatRequest = { ticketId?: number }

let current: HelpChatRequest | null = null
const listeners = new Set<() => void>()

function set(next: HelpChatRequest | null): void {
  current = next
  listeners.forEach((l) => l())
}

export function openHelpChat(ticketId?: number): void {
  set({ ticketId })
}

export function closeHelpChat(): void {
  set(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Открыт ли чат и с какой перепиской (для Shell). */
export function useHelpChat(): HelpChatRequest | null {
  return useSyncExternalStore(subscribe, () => current)
}
