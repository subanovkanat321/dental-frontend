import { expect, test } from 'vitest'

import { startButtonIcons } from './buttonIcons'

function button(label: string, cls = 'btn'): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.textContent = label
  return b
}

test('значок и цвет кнопки — по подписи; без цвета — обычная кнопка', () => {
  const root = document.createElement('div')
  const confirm = button('Подтвердить')
  const move = button('Перенести или передать врачу')
  const walkIn = button('Начать приём')
  const plain = button('Сохранить')
  root.append(confirm, move, walkIn, plain)
  const stop = startButtonIcons(root)
  expect(confirm.dataset.ico).toBe('✅')
  expect(confirm.dataset.tone).toBe('ok')
  expect(move.dataset.tone).toBe('warn')
  expect(walkIn.dataset.tone).toBe('now')
  expect(plain.dataset.tone).toBeUndefined()
  stop()
})
