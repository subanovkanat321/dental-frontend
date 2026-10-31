import { useEffect } from 'react'

import { telegram } from './telegram'

/**
 * Закрыть карточку справа: Esc на компьютере, системная кнопка «Назад» в Telegram. Пока карточка
 * открыта, «Назад» Telegram закрывает её, а не всё приложение.
 */
export function useClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const back = telegram()?.BackButton
    back?.onClick(onClose)
    back?.show()
    return () => {
      window.removeEventListener('keydown', onKey)
      back?.offClick(onClose)
      back?.hide()
    }
  }, [onClose])
}
