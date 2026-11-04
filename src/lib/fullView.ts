import { useState } from 'react'

/**
 * «На весь экран» для карточки приёма и «Сводки дня» на компьютере. Выбор запоминается на этом
 * устройстве (удобство одного человека, не данные): развернули однажды — так и открывается. Нет
 * доступа к localStorage (приватное окно) — просто не запоминаем.
 */
export function useFullView(key: string): [boolean, () => void] {
  const [full, setFull] = useState(() => {
    try {
      return localStorage.getItem(`tish.full.${key}`) === '1'
    }
    catch {
      return false
    }
  })
  const toggle = () => setFull((was) => {
    try {
      localStorage.setItem(`tish.full.${key}`, was ? '0' : '1')
    }
    catch {
      // не запомнили — не страшно
    }
    return !was
  })
  return [full, toggle]
}
