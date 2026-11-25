/**
 * Оформление «UI v2» (docs/ui-v2.md): крупные заголовки, белые карточки на светлом тонированном фоне,
 * плавающее нижнее меню. С 2026-11-25 оно по умолчанию. Старый вид (v1) — запасной выход на время
 * перехода: `?ui=v1` включает его и запоминает на устройстве (флаг в localStorage — удобство, не данные
 * пациента), `?ui=v2` возвращает новый и забывает выбор.
 *
 * Включённое оформление — класс `ui-v2` на <html>: все его правила — в `src/ui-v2*.css` под `.ui-v2`,
 * токены — в `tokens.css`. Компоненты почти не знают о нём; где разметка всё же разная (заголовок
 * пункта «Настроек», нижнее меню телефона, кнопка в пустом списке) — `isUiV2()`.
 */
export const UI_KEY = 'tish.ui'
const CLASS = 'ui-v2'

type UiVersion = 'v1' | 'v2'

function fromUrl(search: string): UiVersion | null {
  const value = new URLSearchParams(search).get('ui')
  return value === 'v2' || value === 'v1' ? value : null
}

/** Какое оформление включить: параметр адреса (и запомнить его), иначе сохранённое, иначе новое (v2). */
export function uiVersion(search: string = window.location.search): UiVersion {
  const asked = fromUrl(search)
  try {
    // Помним только отказ от нового вида: 'v2' от превью (до 2026-11-25) читается как «по умолчанию» и стирается
    if (asked === 'v1') localStorage.setItem(UI_KEY, 'v1')
    else if (asked === 'v2' || localStorage.getItem(UI_KEY) === 'v2') localStorage.removeItem(UI_KEY)
    return asked ?? (localStorage.getItem(UI_KEY) === 'v1' ? 'v1' : 'v2')
  } catch {
    // приватный режим: только по адресу, без памяти
    return asked ?? 'v2'
  }
}

/** До первой отрисовки (main.tsx): класс на <html>. */
export function applyUi(search?: string): void {
  document.documentElement.classList.toggle(CLASS, uiVersion(search) === 'v2')
}

export function isUiV2(): boolean {
  return document.documentElement.classList.contains(CLASS)
}
