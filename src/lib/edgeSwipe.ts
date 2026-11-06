import { isIos, isStandalone } from '../pwa/pwa'
import { backDepth, closeTopLayer } from './back'
import { telegram } from './telegram'

/**
 * Свайп от левого края — «назад», как в приложениях iPhone. Нужен только там, где системного жеста
 * нет: установленное приложение (PWA) на iPhone и Telegram Mini App на iPhone. В Safari жест делает
 * сам браузер (это history.back — lib/back.ts закрывает верхний слой), на Android — системная
 * кнопка/жест «Назад» (тоже history или стрелка Telegram): там не перехватываем.
 *
 * Жест: палец лёг не дальше EDGE от левого края и пошёл вправо (больше, чем по вертикали). Слой
 * едет за пальцем, под ним затемнение; отпустили дальше порога — слой закрывается, раньше — возвращается.
 */
const EDGE = 20
/** Порог закрытия: 70 px или 35% ширины экрана — что меньше */
const CLOSE_PX = 70
const CLOSE_PART = 0.35
/** Пока палец не сдвинулся на столько, направление не решаем */
const SLOP = 8

/** Там свой жест (листание слайдов, вращение модели) — от края не перехватываем */
const OWN_GESTURE = '.lsn, .atlas-page, [data-no-edge-swipe]'

export function edgeSwipeWanted(): boolean {
  if (telegram()) return telegram()?.platform === 'ios'
  return isIos() && isStandalone()
}

function reducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** Внутри прокрутки вбок, уже сдвинутой вправо (ряд чипов, таблица): палец вправо листает её. */
function scrolledSideways(target: Element): boolean {
  for (let n: Element | null = target; n && n !== document.body; n = n.parentElement) {
    if (n.scrollLeft > 0 && n.scrollWidth > n.clientWidth) return true
  }
  return false
}

/** Что двигать за пальцем: внешний слой position: fixed (карточка, лист, полный экран), иначе рабочая область. */
function layerOf(target: Element): HTMLElement | null {
  let found: HTMLElement | null = null
  for (let n: Element | null = target; n && n !== document.body; n = n.parentElement) {
    if (n instanceof HTMLElement && getComputedStyle(n).position === 'fixed') found = n
  }
  return found ?? target.closest<HTMLElement>('main')
}

type Gesture = { id: number; x0: number; y0: number; dx: number; dy: number; el: HTMLElement | null; dir: 'h' | null }
let g: Gesture | null = null

function paint(el: HTMLElement | null, dx: number) {
  if (!el || reducedMotion()) return
  const shade = 0.3 * Math.max(0, 1 - dx / window.innerWidth)
  el.style.transition = 'none'
  el.style.transform = `translateX(${dx}px)`
  // Тень вокруг слоя закрывает открывшуюся слева часть экрана и светлеет по ходу жеста
  el.style.boxShadow = `0 0 0 100vmax rgba(0, 0, 0, ${shade.toFixed(3)})`
}

function clear(el: HTMLElement | null) {
  if (!el) return
  el.style.transition = ''
  el.style.transform = ''
  el.style.boxShadow = ''
}

function settle(el: HTMLElement | null, close: boolean) {
  if (!el || reducedMotion()) {
    clear(el)
    if (close) closeTopLayer()
    return
  }
  el.style.transition = 'transform .18s ease-out, box-shadow .18s ease-out'
  el.style.transform = close ? 'translateX(100%)' : 'translateX(0)'
  el.style.boxShadow = close ? '0 0 0 100vmax rgba(0, 0, 0, 0)' : ''
  setTimeout(() => {
    if (close) closeTopLayer()
    // Слой закрыт и убран — стили уйдут вместе с ним; остался (общая рабочая область, «не выходить») — на место
    requestAnimationFrame(() => clear(el))
  }, 180)
}

function touchOf(e: TouchEvent, id: number): Touch | undefined {
  return [...Array.from(e.changedTouches ?? []), ...Array.from(e.touches ?? [])].find((t) => t.identifier === id)
    ?? e.changedTouches?.[0] ?? e.touches?.[0]
}

function onStart(e: TouchEvent) {
  g = null
  if (e.touches.length !== 1 || backDepth() === 0 || !edgeSwipeWanted()) return
  const t = e.touches[0]!
  if (t.clientX > EDGE) return
  const target = e.target instanceof Element ? e.target : null
  if (!target || target.closest(OWN_GESTURE) || scrolledSideways(target)) return
  g = { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, dy: 0, el: layerOf(target), dir: null }
}

function onMove(e: TouchEvent) {
  if (!g) return
  const t = touchOf(e, g.id)
  if (!t) return
  g.dx = t.clientX - g.x0
  g.dy = t.clientY - g.y0
  if (!g.dir) {
    if (Math.abs(g.dx) < SLOP && Math.abs(g.dy) < SLOP) return
    // Сначала пошёл вниз/вверх или влево — это прокрутка, не наш жест
    if (g.dx <= 0 || Math.abs(g.dy) >= Math.abs(g.dx)) {
      g = null
      return
    }
    g.dir = 'h'
  }
  if (e.cancelable) e.preventDefault()
  paint(g.el, Math.max(0, g.dx))
}

function onEnd(e: TouchEvent) {
  const gesture = g
  g = null
  if (!gesture?.dir) return
  const t = touchOf(e, gesture.id)
  if (t) {
    gesture.dx = t.clientX - gesture.x0
    gesture.dy = t.clientY - gesture.y0
  }
  const far = gesture.dx > Math.min(CLOSE_PX, window.innerWidth * CLOSE_PART)
  settle(gesture.el, far && Math.abs(gesture.dy) < gesture.dx)
}

function onCancel() {
  const gesture = g
  g = null
  if (gesture?.dir) settle(gesture.el, false)
}

/** Слушать жест на всём документе. Возвращает «перестать» (для тестов). */
export function startEdgeSwipe(): () => void {
  document.addEventListener('touchstart', onStart, { passive: true })
  // preventDefault нужен, чтобы страница не прокручивалась, пока тянем слой — не passive
  document.addEventListener('touchmove', onMove, { passive: false })
  document.addEventListener('touchend', onEnd)
  document.addEventListener('touchcancel', onCancel)
  return () => {
    g = null
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onCancel)
  }
}
