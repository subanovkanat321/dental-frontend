import type { MouseEvent } from 'react'

/**
 * Вся строка таблицы открывает карточку (на телефоне строка — карточка, её и нажимают целиком), но
 * кнопки, ссылки и поля внутри строки делают своё — их нажатие строку не открывает.
 */
export function rowClick(open: () => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    open()
  }
}
