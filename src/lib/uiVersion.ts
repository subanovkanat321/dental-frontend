/**
 * Черновик нового оформления «UI v2» (docs/ui-v2.md): крупные заголовки, белые карточки на светлом
 * тонированном фоне, плавающее нижнее меню. Включается по одному устройству — флаг в localStorage
 * (удобство, не данные пациента) или параметр адреса для превью: `?ui=v2` включает и запоминает,
 * `?ui=v1` выключает. По умолчанию выключено, пока владелец не одобрит.
 *
 * Включённое оформление — класс `ui-v2` на <html>: все его правила — в `src/ui-v2.css` под `.ui-v2`,
 * токены — в `tokens.css`. Компоненты почти не знают о нём; где разметка всё же разная (заголовок
 * пункта «Настроек» на телефоне, кнопка в пустом списке) — `isUiV2()`.
 */
export const UI_KEY = 'tish.ui'
const CLASS = 'ui-v2'

type UiVersion = 'v1' | 'v2'

function fromUrl(search: string): UiVersion | null {
  const value = new URLSearchParams(search).get('ui')
  return value === 'v2' || value === 'v1' ? value : null
}

/** Какое оформление включить: параметр адреса (и запомнить его), иначе сохранённое, иначе прежнее. */
export function uiVersion(search: string = window.location.search): UiVersion {
  const asked = fromUrl(search)
  try {
    if (asked === 'v2') localStorage.setItem(UI_KEY, 'v2')
    else if (asked === 'v1') localStorage.removeItem(UI_KEY)
    return asked ?? (localStorage.getItem(UI_KEY) === 'v2' ? 'v2' : 'v1')
  } catch {
    // приватный режим: только по адресу, без памяти
    return asked ?? 'v1'
  }
}

/** До первой отрисовки (main.tsx): класс на <html>. */
export function applyUi(search?: string): void {
  document.documentElement.classList.toggle(CLASS, uiVersion(search) === 'v2')
}

export function isUiV2(): boolean {
  return document.documentElement.classList.contains(CLASS)
}
