import { useState } from 'react'

/**
 * «На весь экран» для карточки приёма и «Сводки дня» на компьютере. Выбор запоминается на этом
 * устройстве (удобство одного человека, не данные): развернули однажды — так и открывается. Нет
 * доступа к localStorage (приватное окно) — просто не запоминаем. `byDefault` — что показать, пока
 * человек ни разу не выбирал.
 */
export function useFullView(key: string, byDefault: () => boolean = () => false): [boolean, () => void] {
  const [full, setFull] = useState(() => {
    try {
      const saved = localStorage.getItem(`tish.full.${key}`)
      // Ещё не выбирали на этом устройстве — значение по умолчанию (меню: свёрнуто на узком ноутбуке)
      return saved == null ? byDefault() : saved === '1'
    }
    catch {
      return byDefault()
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
