import { useSyncExternalStore } from 'react'

/**
 * «Tish обновляется»: интернет у человека есть, а сервер не ответил (обрыв при перезапуске) или nginx
 * ответил «приложение обновляется» (503 с Retry-After, 502/504 без JSON). Флаг ставит и снимает
 * send() в client.ts: первый нормальный ответ сервера — флаг снят. По нему — плашка
 * «🔄 Tish обновляется — минутку…» (layout/OfflineNotice) вместо красной ошибки.
 */
let updating = false
const listeners = new Set<() => void>()

export function setUpdating(value: boolean): void {
  if (updating === value) return
  updating = value
  for (const listener of listeners) listener()
}

export function isUpdatingNow(): boolean {
  return updating
}

export function subscribeUpdating(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUpdating(): boolean {
  return useSyncExternalStore(subscribeUpdating, isUpdatingNow, () => false)
}
