import { useEffect, useState } from 'react'

/** Та же граница, что у карточки на весь экран в crm.css (`.panel { position: fixed; inset: 0 }`). */
export const PHONE_CARD = '(max-width: 760px)'

const matches = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_CARD).matches

/**
 * Карточка приёма открыта на весь экран телефона (и в Telegram Mini App): тогда внизу — закреплённая панель с главной
 * кнопкой и «⋯» (шаг 3). Повернули телефон или сузили окно — перестраивается. Без matchMedia (тесты) — компьютер.
 */
export function usePhoneCard(): boolean {
  const [phone, setPhone] = useState(matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(PHONE_CARD)
    const on = () => setPhone(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return phone
}
