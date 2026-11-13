import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

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
 *
 * Пересчёт — не на каждую отрисовку (getBoundingClientRect заставляет браузер считать раскладку, а
 * сетка перерисовывается часто), а когда поменялось то, от чего зависит место сетки: `key` (день,
 * число колонок, режим), сама сетка (появилась после загрузки), размер окна, размер раздела или
 * страницы (ResizeObserver: догрузился шрифт, строка врачей перенеслась, появилась плашка сверху) и
 * показ раздела (Activity снимает и снова ставит эффекты).
 */
export function useFitToWindow(ref: RefObject<HTMLElement | null>, key: string) {
  const attached = useRef<{ el: HTMLElement; key: string; fit: () => void; detach: () => void } | null>(null)
  // Без списка зависимостей, но дёшево: сравнили элемент и ключ — и всё, если ничего не поменялось
  useLayoutEffect(() => {
    const el = ref.current
    const cur = attached.current
    if (cur && cur.el === el) {
      if (cur.key !== key) {
        cur.key = key
        cur.fit()
      }
      return
    }
    cur?.detach()
    attached.current = null
    if (!el) return
    const main = el.closest('.schedule-main')
    const fit = () => {
      const box = el.getBoundingClientRect()
      el.style.setProperty('--grid-top', `${Math.round(box.top + window.scrollY)}px`)
      el.style.setProperty('--grid-below', `${Math.round(main ? belowIn(el, main) : 0)}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    // (в следующем кадре: высота сетки сама меняет размер раздела — без «ResizeObserver loop» в консоли)
    let frame = 0
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null
    // Место сетки сдвигает и то, что над ней появилось или пропало (закрыли плашку «Заполните профиль»,
    // догрузились напоминания): размер раздела и страницы от этого может не поменяться — следим за соседями
    // сверху на каждом уровне (их размер) и за списком детей предков (появился или пропал сосед)
    const watch = () => {
      if (!observer) return
      observer.disconnect()
      if (main) observer.observe(main)
      observer.observe(document.body)
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) observer.observe(sib)
        for (let sib = node.nextElementSibling; sib && main?.contains(sib); sib = sib.nextElementSibling) observer.observe(sib)
      }
    }
    watch()
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(() => { watch(); later() }) : null
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) mutations?.observe(node, { childList: true })
    attached.current = {
      el, key, fit,
      detach: () => {
        window.removeEventListener('resize', fit)
        observer?.disconnect()
        mutations?.disconnect()
        cancelAnimationFrame(frame)
      },
    }
  })
  // Ушли (или раздел скрыт — Activity): слушатели снять, при показе поставим заново
  useLayoutEffect(() => () => {
    attached.current?.detach()
    attached.current = null
  }, [])
}

/**
 * Сколько места в разделе занимает то, что под сеткой (легенда значков, «Отменено» у «Недели»): высоты
 * соседей после сетки на каждом уровне до раздела. Не «низ раздела минус низ сетки»: так в расчёт
 * попадала сама сетка — посчитали в середине перестройки (закрыли плашку сверху), и пустой хвост под
 * сеткой оставался навсегда: размер раздела больше не менялся, пересчёта не было (2026-11-13).
 */
function belowIn(el: Element, main: Element): number {
  let below = 0
  for (let node: Element | null = el; node && node !== main; node = node.parentElement) {
    for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const style = getComputedStyle(sib)
      if (style.position === 'absolute' || style.position === 'fixed' || style.display === 'none') continue
      below += sib.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)
    }
    const parent = node.parentElement
    if (parent) below += parseFloat(getComputedStyle(parent).paddingBottom) || 0
  }
  return below
}
