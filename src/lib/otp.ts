import { useEffect, useState } from 'react'

/** «Не пришло? Отправить по SMS» — не раньше, чем через минуту: так же считает сервер (раз в минуту на номер). */
export const RESEND_SECONDS = 60

/** Что пишем после «Получить код»: куда ушёл код, сервер не говорит (защита), поэтому — оба варианта. */
export const SENT_AUTO = 'Отправили код: в Telegram (от бота клиники), если номер привязан к вашему Telegram, иначе — SMS на этот номер.'

const SENT_TELEGRAM = 'Отправили код в Telegram (от бота клиники), если номер привязан к вашему Telegram.'

const SENT_SMS = 'Отправили SMS с кодом на этот номер.'

/**
 * Текст после отправки кода.
 *
 * @param bySms код запросили явно по SMS
 * @param telegram код в Telegram возможен (бот настроен; у человека есть Telegram)
 * @param sms SMS подключены
 */
export function sentText(bySms: boolean, telegram: boolean, sms: boolean): string {
  if (bySms || !telegram) return SENT_SMS
  return sms ? SENT_AUTO : SENT_TELEGRAM
}

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
