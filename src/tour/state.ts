import { useEffect, useSyncExternalStore } from 'react'

/**
 * Первые экраны, поверх которых тур не показываем: плашки «Задайте пароль» и «Заполните профиль».
 * Плашка, пока грузит свои данные или видна, отмечается здесь (useFirstScreen); тур ждёт, пока
 * отметок нет (useFirstScreensBusy). Только ключи — без данных человека.
 */
const busy = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Плашка `key` сейчас на экране (или ещё решает, показаться ли) — тур подождёт. */
export function useFirstScreen(key: string, active: boolean) {
  useEffect(() => {
    if (!active) return
    busy.add(key)
    emit()
    return () => {
      busy.delete(key)
      emit()
    }
  }, [key, active])
}

export function useFirstScreensBusy(): boolean {
  return useSyncExternalStore(subscribe, () => busy.size > 0, () => false)
}

/** Отметка сервера «тур видел» (GET/PUT /api/me/tour). */
export const TOUR_KEY = ['me-tour'] as const

/** «Пройти тур ещё раз» (Помощь): событие окна — его слушает тур в Shell. */
export const TOUR_EVENT = 'tish:tour'

export function startTour() {
  window.dispatchEvent(new Event(TOUR_EVENT))
}
