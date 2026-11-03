import { useEffect, useRef } from 'react'

import { telegram } from './telegram'

/**
 * Главная кнопка экрана — своя, прилипшая к низу экрана, и в Telegram, и в браузере.
 * Раньше в Telegram была его MainButton, но её рисует сам Telegram: в части приложений она не
 * появлялась или пропадала (например, когда открывалась клавиатура) — и записаться было нечем.
 * Своя кнопка видна всегда; MainButton Telegram на всякий случай прячем.
 */
export function MainButton({ text, onClick, busy = false }: { text: string; onClick: () => void; busy?: boolean }) {
  const handler = useRef(onClick)
  useEffect(() => {
    handler.current = onClick
  })
  useEffect(() => {
    telegram()?.MainButton?.hide()
  }, [])
  return (
    <div className="main-button-bar">
      <button type="button" className="btn primary" disabled={busy} onClick={() => handler.current()}>{text}</button>
    </div>
  )
}

/** «Назад» Telegram (вверху) — к прошлому экрану; null — назад некуда, кнопки нет. */
export function BackButton({ onBack }: { onBack: (() => void) | null }) {
  const handler = useRef(onBack)
  useEffect(() => {
    handler.current = onBack
  })
  const has = onBack != null
  useEffect(() => {
    const back = telegram()?.BackButton
    if (!back || !has) return
    const click = () => handler.current?.()
    back.onClick(click)
    back.show()
    return () => {
      back.offClick(click)
      back.hide()
    }
  }, [has])
  return null
}
