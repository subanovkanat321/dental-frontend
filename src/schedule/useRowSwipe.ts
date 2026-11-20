import { useEffect, useRef, type RefObject } from 'react'


/**
 * Свайп по строке приёма в «Дне» на телефоне: вправо — одно действие, влево — другое.
 *
 * Жест: палец лёг на строку (не у левого края — там свайп «назад», lib/edgeSwipe.ts) и сдвинулся на
 * SLOP. Пошёл круче 30° к горизонтали — это прокрутка, отпускаем. Пошёл вбок в сторону, где действия нет,
 * — тоже отпускаем. Иначе строка едет за пальцем (CSS-переменная --swipe-x), под ней подложка
 * стороны (атрибут data-swipe), за порогом (35% ширины или 90px) — data-swipe-armed. Отпустили за порогом — действие;
 * до порога, но быстрым фликом (≥ 0,5 px/мс за последние 100 мс и не меньше 40px) — тоже действие.
 * Строка в любом случае пружинит на место. Клик после жеста глушим — карточка не откроется.
 */
export const EDGE = 20
const SLOP = 10
/** Порог действия — 35% ширины строки, но не больше 90px: на широкой строке палец не тянется через пол-экрана */
const PART = 0.35
const MAX_PX = 90
const armedAt = (width: number) => Math.min(width * PART, MAX_PX)
/** Жест считается вертикальным (прокрутка), если он круче 30° к горизонтали: |dy| > |dx|·tg 30° */
const TAN_MAX_ANGLE = Math.tan(Math.PI / 6)
/** Флик: короткий быстрый жест — скорость за последние FLICK_WINDOW мс и минимальный путь */
const FLICK_SPEED = 0.5
const FLICK_WINDOW = 100
const FLICK_MIN_PX = 40

/** Часы жеста. Не Date: в тестах Date подменяют (fixNow), а тут нужны миллисекунды между касаниями */
export const swipeClock = { now: () => performance.now() }

/**
 * Часы «глушим клик ещё N мс после жеста» — монотонные (performance.now), не Date. Date могут перевести (часы
 * телефона), а в тестах он подменён (fixNow, shouldAdvanceTime): поддельные часы идут шагами по 20 мс на таймере
 * и под нагрузкой отстают от настоящих — тест ждал 450 мс, а «прошло» меньше 400, клик глушился, и тест падал
 * через раз (rowswipe.test.tsx, 2026-11-20). Отдельно от swipeClock: тот тесты ведут вручную.
 */
const monotonic = () => performance.now()

export type SwipeActions = {
  /** Нет — жест вправо неактивен */
  right?: () => void
  left?: () => void
  /**
   * Долгое нажатие (палец лежит LONG_MS и не сдвинулся на SLOP) — меню быстрых действий. Сдвинулся — это свайп или
   * прокрутка, таймер снимается; сработало — жест закончен (свайпа уже не будет), клик после него глушим.
   */
  long?: () => void
}

/** Долгое нажатие — как в системных меню телефона */
export const LONG_MS = 500

type Sample = { x: number; t: number }
type Gesture = { id: number; x0: number; y0: number; dx: number; side: 'right' | 'left' | null; width: number; samples: Sample[] }

/** Быстрый жест в сторону side: скорость по точкам за последние FLICK_WINDOW мс */
function isFlick(g: Gesture, endX: number): boolean {
  if (Math.abs(g.dx) < FLICK_MIN_PX) return false
  const t = swipeClock.now()
  const from = g.samples.find((s) => t - s.t <= FLICK_WINDOW)
  if (!from) return false
  const speed = (endX - from.x) / Math.max(t - from.t, 1)
  return g.side === 'right' ? speed >= FLICK_SPEED : -speed >= FLICK_SPEED
}

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
    let timer: ReturnType<typeof setTimeout> | undefined
    // Сработало долгое нажатие, палец ещё лежит: отпускание не должно стать кликом — ни по строке, ни по пункту
    // открывшегося под пальцем листа
    let longFired = false
    const stopTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    const paint = (dx: number, side: 'right' | 'left' | null, armed: boolean) => {
      if (side) el.dataset.swipe = side
      else delete el.dataset.swipe
      if (armed) el.dataset.swipeArmed = ''
      else delete el.dataset.swipeArmed
      // Строка едет за пальцем всегда, и при «Уменьшении движения» на iPhone: это прямое управление,
      // а не анимация (раньше там строка стояла — свайп был «незаметен»). Без анимаций — только без плавного возврата
      el.style.setProperty('--swipe-x', `${dx}px`)
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
      g = { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, side: null, width, samples: [{ x: t.clientX, t: swipeClock.now() }] }
      stopTimer()
      if (latest.current.long) {
        timer = setTimeout(() => {
          timer = undefined
          if (!g || g.side) return
          // Жест закончен: дальнейшее движение пальца не станет свайпом, а отпускание — кликом по строке
          g = null
          longFired = true
          swallowUntil = monotonic() + 700
          latest.current.long?.()
        }, LONG_MS)
      }
    }

    const onMove = (e: TouchEvent) => {
      if (!g) return
      const t = touchOf(e, g.id)
      if (!t) return
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      g.samples.push({ x: t.clientX, t: swipeClock.now() })
      if (g.samples.length > 12) g.samples.shift()
      if (!g.side) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        stopTimer()
        const side = dx > 0 ? 'right' : 'left'
        // Круче 30° — прокрутка; вбок без действия на этой стороне — не наш жест
        if (Math.abs(dy) > Math.abs(dx) * TAN_MAX_ANGLE || !latest.current[side]) {
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
      stopTimer()
      if (longFired) {
        longFired = false
        // Без синтетических мыши и клика после касания (они попали бы в пункт листа под пальцем)
        if (e.cancelable) e.preventDefault()
        swallowClicks()
      }
      const gesture = g
      g = null
      if (!gesture?.side) return
      const t = touchOf(e, gesture.id)
      let endX = gesture.x0 + gesture.dx
      if (t) {
        const dx = t.clientX - gesture.x0
        gesture.dx = gesture.side === 'right' ? Math.max(0, dx) : Math.min(0, dx)
        endX = t.clientX
      }
      swallowUntil = monotonic() + 400
      release()
      if (Math.abs(gesture.dx) >= armedAt(gesture.width) || isFlick(gesture, endX)) latest.current[gesture.side]?.()
    }

    const onCancel = () => {
      stopTimer()
      longFired = false
      const gesture = g
      g = null
      if (gesture?.side) release()
    }

    // Отпустили после жеста — браузер может прислать клик: карточку не открываем
    const onClick = (e: MouseEvent) => {
      // Только по самой строке: «Вернуть» под ней нажимается сразу
      if (monotonic() < swallowUntil && e.target instanceof Element && e.target.closest('.row-slide')) {
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
    // Android сам шлёт contextmenu по долгому нажатию (и правая кнопка мыши): системное меню не нужно — наше уже открыто
    // таймером или откроется сейчас (мышь)
    // Клик сразу после долгого нажатия — по всему документу (лист открылся поверх строки): глушим один раз
    const swallowClicks = () => {
      const until = monotonic() + 700
      const onDocClick = (ev: MouseEvent) => {
        document.removeEventListener('click', onDocClick, true)
        if (monotonic() > until) return
        ev.preventDefault()
        ev.stopPropagation()
      }
      document.addEventListener('click', onDocClick, true)
      setTimeout(() => document.removeEventListener('click', onDocClick, true), 700)
    }
    const onContext = (e: MouseEvent) => {
      if (!latest.current.long || !(e.target instanceof Element) || !e.target.closest('.row-slide')) return
      e.preventDefault()
      if (monotonic() < swallowUntil) return
      stopTimer()
      g = null
      swallowUntil = monotonic() + 700
      latest.current.long()
    }
    el.addEventListener('contextmenu', onContext)
    return () => {
      stopTimer()
      el.removeEventListener('contextmenu', onContext)
      release()
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      el.removeEventListener('click', onClick, true)
    }
  }, [ref, enabled])
}
