/** Вид расписания: «День» (сетка), «Список», «Неделя» или «Месяц». */
export type Mode = 'day' | 'list' | 'week' | 'month'

/**
 * Выбор вида — на устройстве (только слово, не личные данные). С 2026-11-25 (владелец: «пусть на ноуте по дефолту
 * открывается список а не день») умолчание на компьютере — «Список». Ключ .v2: прежний выбор (до смены умолчания) не
 * действует — все один раз получают «Список», дальше свой выбор запоминается. На телефоне вид не важен: там всегда
 * «День» списком.
 */
export const MODE_KEY = 'crm.schedule.mode.v2'
const OLD_MODE_KEY = 'crm.schedule.mode'

/** Умолчание, когда ничего не выбрано. */
export const DEFAULT_MODE: Mode = 'list'
let fallback: Mode = DEFAULT_MODE

/** Только для тестов: тесты сетки написаны под «День» (test/setup.ts). */
export function setDefaultMode(mode: Mode) {
  fallback = mode
}

/** Только для тестов: вернуть настоящее умолчание. */
export function resetDefaultMode() {
  fallback = DEFAULT_MODE
}

export function readMode(): Mode {
  try {
    localStorage.removeItem(OLD_MODE_KEY)
    const saved = localStorage.getItem(MODE_KEY)
    return saved === 'day' || saved === 'list' || saved === 'week' || saved === 'month' ? saved : fallback
  } catch {
    return fallback
  }
}

export function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // приватный режим
  }
}
