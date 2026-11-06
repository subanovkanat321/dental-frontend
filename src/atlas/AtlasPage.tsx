import { useEffect } from 'react'

import { useBack } from '../lib/back'
import { Atlas } from './Atlas'
import type { AtlasRoute } from './route'

/**
 * Атлас на весь экран — для показа пациенту на ТВ или мониторе. Fullscreen API прячет панели браузера;
 * в Telegram его нет — там атлас просто занимает всё окно (оверлей), а «назад» Telegram его закрывает.
 * Без персональных данных: ни имени, ни карты пациента на экране нет.
 */
/** @param byUrl атлас открыт адресом #/atlas: шаг «назад» уже в истории браузера */
export function AtlasPage({ route, onClose, byUrl = false }: { route: AtlasRoute; onClose: () => void; byUrl?: boolean }) {
  useBack(onClose, { url: byUrl })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc в полноэкранном режиме браузер забирает себе (выход из него); иначе — закрыть атлас
      if (e.key === 'Escape' && !document.fullscreenElement) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="atlas-page">
      <Atlas initialMode={route.mode} initialTooth={route.tooth} onClose={onClose} fullscreen />
    </div>
  )
}

export default AtlasPage
