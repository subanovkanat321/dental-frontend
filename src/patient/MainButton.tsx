import { useEffect, useRef } from 'react'

import { telegram } from '../lib/telegram'

/**
 * Главная кнопка экрана: в Telegram — его MainButton внизу (как в приложении), в браузере и
 * тестах — своя кнопка, прилипшая к низу экрана. Обработчик берётся свежий на каждом нажатии.
 */
export function MainButton({ text, onClick, busy = false }: { text: string; onClick: () => void; busy?: boolean }) {
  const handler = useRef(onClick)
  useEffect(() => {
    handler.current = onClick
  })
  const button = telegram()?.MainButton
  useEffect(() => {
    if (!button) return
    const click = () => handler.current()
    button.onClick(click)
    button.show()
    return () => {
      button.offClick(click)
      button.hideProgress()
      button.hide()
    }
  }, [button])
  useEffect(() => {
    if (!button) return
    button.setText(text)
    if (busy) {
      button.showProgress()
      button.disable()
    } else {
      button.hideProgress()
      button.enable()
    }
  }, [button, text, busy])
  if (button) return null
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
