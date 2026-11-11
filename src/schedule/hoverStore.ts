import type { Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

/** Задержка до карточки: мышь, которая просто проходит над сеткой, не мигает карточками. */
const HOVER_DELAY = 300

export type Shown = { a: Appointment; rect: DOMRect; el: HTMLElement }

/**
 * Что показано — маленькое хранилище вне React-состояния сетки: наведение мыши не перерисовывает
 * весь «День» (сотни блоков), а только саму всплывающую карточку (HoverLayer).
 */
export function createHoverStore() {
  let shown: Shown | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const set = (next: Shown | null) => {
    if (shown === next) return
    // aria-describedby — у блока под мышью; ставим прямо в DOM: блоку не нужна перерисовка
    shown?.el.removeAttribute('aria-describedby')
    shown = next
    listeners.forEach((l) => l())
  }
  return {
    get: () => shown,
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => { listeners.delete(l) }
    },
    showLater: (a: Appointment, el: HTMLElement) => {
      clearTimeout(timer)
      timer = setTimeout(() => set({ a, el, rect: el.getBoundingClientRect() }), HOVER_DELAY)
    },
    hide: () => {
      clearTimeout(timer)
      set(null)
    },
  }
}
export type HoverStore = ReturnType<typeof createHoverStore>
