import { useEffect, useRef, type RefObject } from 'react'

/**
 * Нижний лист на телефоне закрывается свайпом вниз — как в iOS и Android: у листа сверху «ручка»
 * (серая полоска), и её тянут вниз.
 *
 * Жест: палец лёг на лист и сдвинулся на SLOP. Пошёл больше вбок или вверх — не наш (листание месяца,
 * прокрутка, свайп «назад» от края), отпускаем и ничего не трогаем. Пошёл вниз — тянем, если палец
 * лёг на шапку (верхние GRIP px листа или элемент с `data-sheet-grip`), либо всё прокручиваемое под
 * пальцем уже в самом верху (scrollTop === 0): иначе вниз — это прокрутка списка, её не отнимаем.
 * Лист едет за пальцем (transform), фон тускнеет. Отпустили дальше четверти высоты (не больше
 * MAX_PX) или быстро смахнули — закрываем тем же onClose, что у ✕ и «Закрыть» (а значит, и шаг
 * «назад» в истории уходит как обычно — lib/back.ts). Иначе лист возвращается на место.
 *
 * Только сенсорные события (touch*): мышь их не присылает, на компьютере всё как было.
 * Поля ввода, холст и `data-no-sheet-swipe` жест не начинают. «Уменьшение движения» — без анимаций
 * возврата и ухода, но лист за пальцем едет (это прямое управление, а не анимация) и закрывается.
 *
 * @param ref лист (тот элемент, что едет); фон — его родитель, если у того есть свой цвет
 * @param onClose null — лист закрыт или не лист (компьютер): жест выключен
 */
const SLOP = 8
/** Шапка листа: отсюда тянуть можно всегда, даже если список внутри прокручен */
const GRIP = 56
const PART = 0.25
const MAX_PX = 160
/** Быстрый флик, px/мс: закрывает и с коротким ходом */
const FLICK = 0.5
const FLICK_MIN = 24
const SETTLE_MS = 180

const SKIP = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, canvas, [contenteditable=""], [contenteditable=true], [data-no-sheet-swipe]'

type Gesture = {
  id: number
  x0: number
  y0: number
  /** Тянуть можно: шапка или всё под пальцем прокручено вверх */
  free: boolean
  dragging: boolean
  dy: number
  /** Две последние точки — для скорости */
  lastY: number
  lastT: number
  v: number
  height: number
}

function touchOf(e: TouchEvent, id: number): Touch | undefined {
  return [...Array.from(e.changedTouches ?? []), ...Array.from(e.touches ?? [])].find((t) => t.identifier === id)
}

/** Всё прокручиваемое от пальца до листа (включительно) — в самом верху */
function atTop(from: EventTarget | null, sheet: HTMLElement): boolean {
  let el = from instanceof Element ? from : null
  while (el) {
    if (el.scrollTop > 0) return false
    if (el === sheet) break
    el = el.parentElement
  }
  return true
}

function reducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** «rgba(10, 25, 30, 0.38)» → [r, g, b, a]; прозрачный или не разобрали — null */
function rgba(color: string): [number, number, number, number] | null {
  const m = /rgba?\(([^)]+)\)/.exec(color)
  if (!m) return null
  const [r, g, b, a = 1] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number)
  if (r == null || g == null || b == null || !(a > 0)) return null
  return [r, g, b, a]
}

/**
 * Клик сразу после жеста (браузер иногда присылает его туда, где отпустили палец) — глушим один, и
 * только по листу и его фону: нажатие по странице после закрытия листа проходит
 */
function swallowClick(area: Element) {
  const onClick = (e: MouseEvent) => {
    stop()
    if (e.target instanceof Node && area.contains(e.target)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  const timer = setTimeout(() => stop(), 350)
  const stop = () => {
    clearTimeout(timer)
    window.removeEventListener('click', onClick, true)
  }
  window.addEventListener('click', onClick, true)
}

export function useSwipeDown(ref: RefObject<HTMLElement | null>, onClose: (() => void) | null) {
  const latest = useRef(onClose)
  useEffect(() => { latest.current = onClose })
  const enabled = onClose != null

  useEffect(() => {
    const sheet = ref.current
    if (!enabled || !sheet) return
    const backdrop = sheet.parentElement
    // Свой цвет фона в style (если был) — вернуть как было
    const own = backdrop?.style.backgroundColor ?? ''
    let base: [number, number, number, number] | null = null
    let g: Gesture | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const paint = (dy: number, height: number) => {
      sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
      if (backdrop && base) {
        const [r, gr, b, a] = base
        const k = Math.max(0, 1 - dy / Math.max(height, 1))
        backdrop.style.backgroundColor = dy > 0 ? `rgba(${r}, ${gr}, ${b}, ${(a * k).toFixed(3)})` : own
      }
    }
    const settle = (then?: () => void) => {
      if (reducedMotion()) {
        then?.()
        return
      }
      sheet.style.transition = `transform ${SETTLE_MS}ms ease-out`
      if (backdrop && base) backdrop.style.transition = `background-color ${SETTLE_MS}ms ease-out`
      timer = setTimeout(() => {
        sheet.style.transition = ''
        if (backdrop) backdrop.style.transition = ''
        then?.()
      }, SETTLE_MS)
    }

    const onStart = (e: TouchEvent) => {
      g = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]!
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest(SKIP)) return
      const rect = sheet.getBoundingClientRect()
      const grip = t.clientY - rect.top <= GRIP || !!target?.closest('[data-sheet-grip]')
      g = {
        id: t.identifier, x0: t.clientX, y0: t.clientY, free: grip || atTop(target, sheet), dragging: false, dy: 0,
        lastY: t.clientY, lastT: e.timeStamp || Date.now(), v: 0, height: rect.height || sheet.offsetHeight || window.innerHeight,
      }
    }

    const onMove = (e: TouchEvent) => {
      if (!g) return
      const t = touchOf(e, g.id)
      if (!t) return
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.dragging) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
        // Вбок, вверх или список ещё не наверху — жест не наш
        if (dy <= 0 || Math.abs(dx) >= dy || !g.free) {
          g = null
          return
        }
        g.dragging = true
        clearTimeout(timer)
        sheet.style.transition = 'none'
        if (backdrop) {
          backdrop.style.transition = 'none'
          backdrop.style.backgroundColor = own
          base = rgba(getComputedStyle(backdrop).backgroundColor)
        }
      }
      // Не даём прокрутке и «резинке» iOS тянуть страницу вместе с листом
      if (e.cancelable) e.preventDefault()
      const now = e.timeStamp || Date.now()
      if (now > g.lastT) g.v = (t.clientY - g.lastY) / (now - g.lastT)
      g.lastY = t.clientY
      g.lastT = now
      g.dy = Math.max(0, dy)
      paint(g.dy, g.height)
    }

    const onEnd = (e: TouchEvent) => {
      const gesture = g
      g = null
      if (!gesture?.dragging) return
      const t = touchOf(e, gesture.id)
      if (t) {
        const now = e.timeStamp || Date.now()
        if (now > gesture.lastT && t.clientY !== gesture.lastY) gesture.v = (t.clientY - gesture.lastY) / (now - gesture.lastT)
        gesture.dy = Math.max(0, t.clientY - gesture.y0)
      }
      swallowClick(backdrop ?? sheet)
      const far = gesture.dy >= Math.min(gesture.height * PART, MAX_PX)
      const flick = gesture.v >= FLICK && gesture.dy >= FLICK_MIN
      if (far || flick) {
        // Уезжает вниз за край и закрывается — тем же обработчиком, что ✕
        // Сначала transition, потом новое положение — иначе браузер перескочит без анимации
        settle(() => {
          latest.current?.()
          // Лист не закрылся (занят, отказался) — вернуть на место
          timer = setTimeout(() => {
            if (g || !sheet.isConnected) return
            settle()
            paint(0, gesture.height)
          }, 120)
        })
        paint(gesture.height + 40, gesture.height)
      } else {
        settle()
        paint(0, gesture.height)
      }
    }

    const onCancel = () => {
      const gesture = g
      g = null
      if (!gesture?.dragging) return
      settle()
      paint(0, gesture.height)
    }

    sheet.addEventListener('touchstart', onStart, { passive: true })
    // preventDefault, пока тянем: не passive
    sheet.addEventListener('touchmove', onMove, { passive: false })
    sheet.addEventListener('touchend', onEnd)
    sheet.addEventListener('touchcancel', onCancel)
    return () => {
      clearTimeout(timer)
      sheet.removeEventListener('touchstart', onStart)
      sheet.removeEventListener('touchmove', onMove)
      sheet.removeEventListener('touchend', onEnd)
      sheet.removeEventListener('touchcancel', onCancel)
      sheet.style.transform = ''
      sheet.style.transition = ''
      if (backdrop) {
        backdrop.style.backgroundColor = own
        backdrop.style.transition = ''
      }
    }
  }, [ref, enabled])
}
