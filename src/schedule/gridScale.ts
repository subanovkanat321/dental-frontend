import { useEffect, useState } from 'react'

import { minutesOf } from '../lib/time'

/** Общая шкала сеток «День» и «Неделя» (DESIGN.md → Layout). */

/** Сколько пикселей на минуту: час — 90 px; приём на 30 минут вмещает время и имя, на 45 — ещё статус. */
export const PX = 1.5

/** Ниже этой высоты блок — одной строкой: время начала и имя. */
export const SHORT = 46

/** Отступ сверху и снизу сетки: подпись первого часа («09:00») не обрезается. */
export const PAD = 14

/** 615 → «10:15». */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Минуты от полуночи «сейчас» по Бишкеку; обновляются раз в минуту — линия «сейчас» ползёт сама. */
export function useNowMinutes(): number {
  const [now, setNow] = useState(() => minutesOf(new Date().toISOString()))
  useEffect(() => {
    const t = setInterval(() => setNow(minutesOf(new Date().toISOString())), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}
