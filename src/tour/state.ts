import { useEffect, useSyncExternalStore } from 'react'

import { api, unwrap } from '../api/client'
import { demoTourSeen, isDemoSession } from '../lib/demo'

/**
 * Первые экраны, поверх которых тур не показываем: плашка «Заполните профиль» (и будущие такие же).
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

/**
 * «Тур видел?» — одна функция на всех, кто ждёт тура (тур, «Совет дня», плашка профиля, push). В демо «сотрудник»
 * общий у всех гостей: сервер отметку не хранит, её помнит вкладка (lib/demo.ts).
 */
export async function fetchTour(): Promise<{ seenAt?: string | null }> {
  if (isDemoSession()) {
    const seen = demoTourSeen()
    if (seen) return { seenAt: seen }
  }
  return unwrap(api.GET('/api/me/tour'))
}

/** «Пройти тур ещё раз» (Помощь): событие окна — его слушает тур в Shell. */
export const TOUR_EVENT = 'tish:tour'

export function startTour() {
  window.dispatchEvent(new Event(TOUR_EVENT))
}
