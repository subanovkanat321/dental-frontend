import { telegram } from './telegram'

/**
 * Оформление на этом устройстве (localStorage — удобство, а не данные пациента), как в прежнем
 * приложении: светлая (по умолчанию), тёмная или «как в Telegram» (вне Telegram — как в системе).
 * Размер текста — обычный или крупный. Ключ темы тот же, что у прежнего приложения: выбор сохранится.
 */
type ThemeChoice = 'light' | 'dark' | 'auto'
type TextSize = 'normal' | 'large'

export const THEMES: [ThemeChoice, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['auto', telegram() ? 'Как в Telegram' : 'Как в системе']]
export const TEXT_SIZES: [TextSize, string][] = [['normal', 'Обычный'], ['large', 'Крупный']]

const THEME_KEY = 'dental.theme'
const SIZE_KEY = 'dental.textSize'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // приватный режим: выбор продержится до закрытия
  }
}

export function themeChoice(): ThemeChoice {
  const saved = read(THEME_KEY)
  return saved === 'dark' || saved === 'auto' ? saved : 'light'
}

export function textSize(): TextSize {
  return read(SIZE_KEY) === 'large' ? 'large' : 'normal'
}

/** Тема на экране: «авто» — по Telegram, вне его — по системе. */
function resolveTheme(choice: ThemeChoice, telegramScheme?: string, systemDark = false): 'light' | 'dark' {
  if (choice === 'auto') return (telegramScheme ?? (systemDark ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light'
  return choice
}

/** Поставить тему и размер на <html>; шапку Telegram — в цвет страницы (иначе белая над тёмным). */
export function applyLook(): void {
  const tg = telegram()
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const root = document.documentElement
  root.dataset.theme = resolveTheme(themeChoice(), tg?.colorScheme, systemDark)
  root.dataset.textSize = textSize()
  const page = getComputedStyle(root).getPropertyValue('--page').trim()
  try {
    if (page) {
      tg?.setHeaderColor?.(page)
      tg?.setBackgroundColor?.(page)
    }
  } catch {
    // старый Telegram без этих методов
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  write(THEME_KEY, choice)
  applyLook()
}

export function setTextSize(size: TextSize): void {
  write(SIZE_KEY, size)
  applyLook()
}
