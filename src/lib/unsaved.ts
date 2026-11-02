import { useEffect, useRef, useState } from 'react'

import { useSectionActive } from './section'
import { telegram } from './telegram'

/**
 * Несохранённые изменения в формах «Настроек». Форма с правками записывает себя сюда (useDirty), а
 * «назад» пункта или карточки (SubHeader, useClose, ✕) спрашивает confirmLeave() перед уходом.
 * Считаются только формы раздела на экране: App держит разделы живыми, и правки в скрытом разделе
 * никуда не пропадут — переход между разделами не спрашиваем.
 */
const dirtyForms = new Set<object>()

export const LEAVE_TEXT = 'Есть несохранённые изменения — выйти без сохранения?'

function syncTelegram() {
  // Закрыть Mini App свайпом вниз с несохранённым — Telegram сам спросит «закрыть?»
  const app = telegram()
  if (dirtyForms.size) app?.enableClosingConfirmation?.()
  else app?.disableClosingConfirmation?.()
}

/** Отметить форму «есть правки», пока dirty и раздел на экране. */
export function useUnsaved(dirty: boolean): void {
  const visible = useSectionActive()
  const on = dirty && visible
  useEffect(() => {
    if (!on) return
    const token = {}
    dirtyForms.add(token)
    syncTelegram()
    return () => {
      dirtyForms.delete(token)
      syncTelegram()
    }
  }, [on])
}

/** Можно уходить: правок нет или человек согласился их бросить. */
export function confirmLeave(): boolean {
  return dirtyForms.size === 0 || window.confirm(LEAVE_TEXT)
}

/** onLeave, который сначала спрашивает про несохранённое. */
export function guarded(onLeave: () => void): () => void {
  return () => {
    if (confirmLeave()) onLeave()
  }
}

/**
 * Есть ли правки: сравниваем текущее значение формы с сохранённым (JSON). commit() — «сохранили»:
 * текущее становится новой точкой отсчёта (форма не пересоздаётся после ответа сервера).
 */
export function useDirty(value: unknown): { dirty: boolean; commit: () => void } {
  const json = JSON.stringify(value)
  const [base, setBase] = useState(json)
  const latest = useRef(json)
  useEffect(() => {
    latest.current = json
  })
  const dirty = json !== base
  useUnsaved(dirty)
  return { dirty, commit: () => setBase(latest.current) }
}
