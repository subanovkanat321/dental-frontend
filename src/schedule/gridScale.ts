import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

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

/**
 * Сетка «Дня» и «Недели» — до низа окна, где бы она ни начиналась (напоминания, строка врачей сверху):
 * без двойной прокрутки страницы и сетки. Ставит сетке `--grid-top` (откуда она начинается) и
 * `--grid-below` (что под ней в разделе: «Отменено» у «Недели», легенда значков) — высоту считает CSS.
 * Пересчёт — после каждой отрисовки, при смене размера окна и раздела (строка над сеткой могла перенестись).
 */
export function useFitToWindow(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const box = el.getBoundingClientRect()
      el.style.setProperty('--grid-top', `${Math.round(box.top + window.scrollY)}px`)
      const main = el.closest('.schedule-main')
      const below = main ? Math.max(0, main.getBoundingClientRect().bottom - box.bottom) : 0
      el.style.setProperty('--grid-below', `${Math.round(below)}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    // Высота над сеткой меняется и без новой отрисовки React: догрузился шрифт, строка врачей перенеслась
    const main = el.closest('.schedule-main')
    // (в следующем кадре: высота сетки сама меняет размер раздела — без «ResizeObserver loop» в консоли)
    let frame = 0
    const observer = typeof ResizeObserver === 'function' && main
      ? new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }) : null
    if (observer && main) observer.observe(main)
    return () => {
      window.removeEventListener('resize', fit)
      observer?.disconnect()
      cancelAnimationFrame(frame)
    }
  })
}
