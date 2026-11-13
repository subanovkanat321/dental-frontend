import type { MouseEvent } from 'react'

/**
 * Вся строка списка открывает карточку («нажимается вся строка», DESIGN.md). Название в строке
 * остаётся настоящей кнопкой или ссылкой — её находят Tab и скринридер; строка лишь расширяет зону
 * клика мышью и пальцем (tabindex у строки нет: иначе в клавиатуре два стопа на одно действие).
 *
 * Строку НЕ открывает:
 * - нажатие на кнопку, ссылку, поле, чекбокс, селект внутри строки — они делают своё («−1» списывает);
 * - выделение текста мышью (скопировать телефон или название) — после него `click` тоже приходит;
 * - элемент с `data-row-skip` — для своих интерактивных мест без роли.
 */
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, details, [role="button"], [role="link"], '
  + '[role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [contenteditable=""], [contenteditable="true"], [data-row-skip]'

/** Пользователь выделил текст (протянул мышью) — это не «открыть», а «скопировать». */
function selecting(): boolean {
  const s = typeof window.getSelection === 'function' ? window.getSelection() : null
  return !!s && !s.isCollapsed && s.toString().trim() !== ''
}

function rowClick(open: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0) return
    const hit = (e.target as Element).closest?.(INTERACTIVE)
    if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return
    if (selecting()) return
    open()
  }
}

/**
 * Пропсы кликабельной строки одной строкой: `<tr key={x.id} {...rowOpen(() => setOpened(x.id), x.id === opened && 'active')}>`.
 * `open` пустой (нет прав, только чтение) — строка обычная: остаются только классы.
 */
export function rowOpen(open: (() => void) | null | undefined | false, ...classes: (string | false | null | undefined)[]) {
  const className = [open ? 'clickable' : '', ...classes].filter(Boolean).join(' ') || undefined
  return open ? { className, onClick: rowClick(open) } : { className }
}
