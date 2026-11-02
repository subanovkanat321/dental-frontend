import { useEffect, useRef } from 'react'

import { useBack } from './back'

/**
 * Закрыть карточку справа: Esc на компьютере, стрелка «назад» в Telegram. Пока карточка
 * открыта, «назад» закрывает её, а не уводит с экрана (стопка шагов — lib/back.ts).
 */
/** @param enabled false — панель встроена в страницу (inline): ни «назад», ни Esc ей не нужны */
export function useClose(onClose: () => void, enabled = true): void {
  useBack(enabled ? onClose : null)
  const handler = useRef(onClose)
  useEffect(() => {
    handler.current = onClose
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handler.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
