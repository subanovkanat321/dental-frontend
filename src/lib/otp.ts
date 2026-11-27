import { useEffect, useState } from 'react'

/** «Отправить код ещё раз» — не раньше, чем через минуту: так же считает сервер (раз в минуту на номер). */
export const RESEND_SECONDS = 60

/**
 * Что пишем после «Получить код» в Telegram: куда ушёл код, сервер не говорит (защита) — поэтому «если номер привязан».
 * SMS убраны из входа 2026-11-27: код приходит только в Telegram или на почту.
 */
export const SENT_TELEGRAM = 'Отправили код в Telegram (от бота клиники), если номер привязан к вашему Telegram.'

/**
 * Обратный отсчёт до повторной отправки: {@link RESEND_SECONDS} секунд после каждой отправки; после
 * перезагрузки страницы — сколько осталось по словам сервера.
 */
export function useCountdown(): [number, (seconds?: number) => void] {
  const [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])
  return [wait, (seconds = RESEND_SECONDS) => setWait(seconds)]
}

/** Первые 6 цифр подряд из скопированного: «Код: 123 456» или «<code>123456</code>» → «123456». */
export function codeFromText(text: string): string | null {
  const digits = /\d{6}/.exec(text.replace(/[\s-]/g, ''))
  return digits ? digits[0] : null
}
