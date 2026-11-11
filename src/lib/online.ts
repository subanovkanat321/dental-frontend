import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

/**
 * Есть ли сеть — по onlineManager React Query (события online/offline браузера). Без сети запросы
 * на паузе (fetchStatus 'paused'): вместо вечной «Загрузки…» показываем, что ждём связь.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () => onlineManager.isOnline(), () => true)
}
