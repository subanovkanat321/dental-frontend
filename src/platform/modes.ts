import { useSyncExternalStore } from 'react'

import { platformModeInHash, setPlatformModeInHash } from '../lib/route'

/**
 * Режимы объединённых вкладок «Платформы» (2026-11-14): «Рассылка клиникам» (по одной / всем сразу),
 * «Обратная связь» (обращения / опросы), «Маркетинг» (контент-план / материалы). Режим — третий кусок адреса
 * (#/platform/mailing/all): старые адреса вкладок ведут сюда (lib/route → PLATFORM_MOVED), обновили
 * страницу — тот же режим. Последний режим вкладки помним, пока открыта вкладка браузера, — как подразделы (lib/sub).
 */
export type ModeOption<T extends string> = { value: T; label: string }

const last: Record<string, string> = {}
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('hashchange', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('hashchange', listener)
  }
}

/** Режим вкладки `sub`: из адреса, иначе последний выбранный, иначе первый из `options`. */
export function usePlatformMode<T extends string>(sub: string, options: readonly ModeOption<T>[]): [T, (mode: T) => void] {
  const raw = useSyncExternalStore(subscribe, () => {
    const inHash = platformModeInHash(sub)
    if (inHash) last[sub] = inHash
    return last[sub] ?? null
  })
  const mode = options.find((o) => o.value === raw)?.value ?? options[0]!.value
  const set = (next: T) => {
    last[sub] = next
    setPlatformModeInHash(sub, next)
    for (const l of listeners) l()
  }
  return [mode, set]
}

/** Тесты: забыть запомненные режимы. */
export function resetPlatformModes(): void {
  for (const k of Object.keys(last)) delete last[k]
}
