import { useEffect, useState } from 'react'

import { telegram } from './telegram'

/**
 * Где показываем QR-код: широкий экран с мышью — компьютер. На телефоне (и в планшете пальцем) Telegram обычно
 * под рукой — там, как и было, только кнопка «Войти через Telegram»; внутри Telegram (Mini App) QR не нужен вовсе.
 */
export const QR_SCREEN = '(min-width: 900px) and (hover: hover) and (pointer: fine)'

function qrScreen(): boolean {
  return !telegram() && typeof window.matchMedia === 'function' && window.matchMedia(QR_SCREEN).matches
}

/** Компьютер, где стоит показать QR-код рядом с кнопкой Telegram; следит за размером окна. */
export function useQrScreen(): boolean {
  const [on, setOn] = useState(qrScreen)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(QR_SCREEN)
    const change = () => setOn(qrScreen())
    mq.addEventListener?.('change', change)
    return () => mq.removeEventListener?.('change', change)
  }, [])
  return on
}
