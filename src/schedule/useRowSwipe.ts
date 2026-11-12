import { useEffect, useRef, type RefObject } from 'react'

import { matches } from '../lib/useMedia'

/**
 * Свайп по строке приёма в «Дне» на телефоне: вправо — одно действие, влево — другое.
 *
 * Жест: палец лёг на строку (не у левого края — там свайп «назад», lib/edgeSwipe.ts) и сдвинулся на
 * SLOP. Пошёл больше по вертикали — это прокрутка, отпускаем. Пошёл вбок в сторону, где действия нет,
 * — тоже отпускаем. Иначе строка едет за пальцем (CSS-переменная --swipe-x), под ней подложка
 * стороны (атрибут data-swipe), за порогом (35% ширины или 90px) — data-swipe-armed. Отпустили за порогом — действие;
 * строка в любом случае пружинит на место. Клик после жеста глушим — карточка не откроется.
 */
export const EDGE = 20
const SLOP = 10
/** Порог действия — 35% ширины строки, но не больше 90px: на широкой строке палец не тянется через пол-экрана */
const PART = 0.35
const MAX_PX = 90
const armedAt = (width: number) => Math.min(width * PART, MAX_PX)

export type SwipeActions = {
  /** Нет — жест вправо неактивен */
  right?: () => void
  left?: () => void
}

type Gesture = { id: number; x0: number; y0: number; dx: number; side: 'right' | 'left' | null; width: number }

function touchOf(e: TouchEvent, id: number): Touch | undefined {
  return [...Array.from(e.changedTouches ?? []), ...Array.from(e.touches ?? [])].find((t) => t.identifier === id)
}

export function useRowSwipe(ref: RefObject<HTMLElement | null>, enabled: boolean, actions: SwipeActions) {
  // Свежие обработчики без переподписки на каждый рендер
  const latest = useRef(actions)
  useEffect(() => { latest.current = actions })

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    let g: Gesture | null = null
    let swallowUntil = 0

    const paint = (dx: number, side: 'right' | 'left' | null, armed: boolean) => {
      if (side) el.dataset.swipe = side
      else delete el.dataset.swipe
      if (armed) el.dataset.swipeArmed = ''
      else delete el.dataset.swipeArmed
      // Без анимаций — строка не едет, но подложка и «порог пройден» видны
      el.style.setProperty('--swipe-x', matches('(prefers-reduced-motion: reduce)') ? '0px' : `${dx}px`)
    }
    const release = () => {
      el.classList.remove('swiping')
      paint(0, null, false)
    }

    const onStart = (e: TouchEvent) => {
      g = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]!
      // У левого края — свайп «назад» (edgeSwipe), не наш
      if (t.clientX <= EDGE) return
      const width = el.getBoundingClientRect().width || window.innerWidth
      g = { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, side: null, width }
    }

    const onMove = (e: TouchEvent) => {
      if (!g) return
      const t = touchOf(e, g.id)
      if (!t) return
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.side) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        const side = dx > 0 ? 'right' : 'left'
        // Вертикаль — прокрутка; вбок без действия на этой стороне — не наш жест
        if (Math.abs(dy) >= Math.abs(dx) || !latest.current[side]) {
          g = null
          return
        }
        g.side = side
        el.classList.add('swiping')
      }
      if (e.cancelable) e.preventDefault()
      // Только в сторону действия и не дальше ширины строки
      g.dx = g.side === 'right' ? Math.min(Math.max(0, dx), g.width) : Math.max(Math.min(0, dx), -g.width)
      paint(g.dx, g.side, Math.abs(g.dx) >= armedAt(g.width))
    }

    const onEnd = (e: TouchEvent) => {
      const gesture = g
      g = null
      if (!gesture?.side) return
      const t = touchOf(e, gesture.id)
      if (t) {
        const dx = t.clientX - gesture.x0
        gesture.dx = gesture.side === 'right' ? Math.max(0, dx) : Math.min(0, dx)
      }
      swallowUntil = Date.now() + 400
      release()
      if (Math.abs(gesture.dx) >= armedAt(gesture.width)) latest.current[gesture.side]?.()
    }

    const onCancel = () => {
      const gesture = g
      g = null
      if (gesture?.side) release()
    }

    // Отпустили после жеста — браузер может прислать клик: карточку не открываем
    const onClick = (e: MouseEvent) => {
      // Только по самой строке: «Вернуть» под ней нажимается сразу
      if (Date.now() < swallowUntil && e.target instanceof Element && e.target.closest('.row-slide')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    // preventDefault — чтобы список не прокручивался, пока тянем строку: не passive
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    el.addEventListener('click', onClick, true)
    return () => {
      release()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      el.removeEventListener('click', onClick, true)
    }
  }, [ref, enabled])
}
