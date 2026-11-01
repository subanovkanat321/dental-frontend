import { useEffect, useRef } from 'react'

import { useBack } from './back'

/**
 * Закрыть карточку справа: Esc на компьютере, стрелка «назад» в Telegram. Пока карточка
 * открыта, «назад» закрывает её, а не уводит с экрана (стопка шагов — lib/back.ts).
 */
export function useClose(onClose: () => void): void {
  useBack(onClose)
  const handler = useRef(onClose)
  useEffect(() => {
    handler.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handler.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
