import { useEffect, useRef } from 'react'

import { useBack } from './back'
import { useSectionActive } from './section'
import { guarded } from './unsaved'

/**
 * Закрыть карточку справа: Esc на компьютере, стрелка «назад» в Telegram. Пока карточка
 * открыта, «назад» закрывает её, а не уводит с экрана (стопка шагов — lib/back.ts).
 * Есть несохранённые правки (lib/unsaved.ts) — сначала спросим. Возвращает то же «закрыть с
 * вопросом» — для кнопки ✕ карточки.
 */
/** @param enabled false — панель встроена в страницу (inline): ни «назад», ни Esc ей не нужны */
export function useClose(onClose: () => void, enabled = true): () => void {
  const visible = useSectionActive()
  const on = enabled && visible
  const close = guarded(onClose)
  useBack(on ? close : null)
  const handler = useRef(close)
  useEffect(() => {
    handler.current = close
  })
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && handler.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on])
  return close
}
