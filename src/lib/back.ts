import { useEffect, useRef } from 'react'

import { telegram } from './telegram'

/**
 * Стрелка «назад» Telegram (вверху слева) — одна на всё приложение, а вложенных экранов много:
 * пункт «Настроек», в нём карточка врача, медкарта поверх расписания… Каждый открытый экран
 * кладёт свой шаг назад в стопку; стрелка видна, пока стопка не пуста, и делает верхний шаг.
 * Закрыли экран — его шаг убрали, стрелка ведёт на шаг ниже (а не пропадает совсем).
 */
const stack: { current: () => void }[] = []
let wiredTo: object | null = null

function onBackClick() {
  stack.at(-1)?.current()
}

function sync() {
  const back = telegram()?.BackButton
  if (!back) return
  if (wiredTo !== back) {
    back.onClick(onBackClick)
    wiredTo = back
  }
  if (stack.length) back.show()
  else back.hide()
}

/** Пока экран открыт — «назад» в Telegram выполняет onBack. null — экран без шага назад. */
export function useBack(onBack: (() => void) | null): void {
  const handler = useRef(onBack)
  useEffect(() => {
    handler.current = onBack
  })
  const active = onBack != null
  useEffect(() => {
    if (!active) return
    const entry = { current: () => handler.current?.() }
    stack.push(entry)
    sync()
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      sync()
    }
  }, [active])
}

/** Для тестов: сколько шагов назад сейчас в стопке. */
export function backDepth(): number {
  return stack.length
}
