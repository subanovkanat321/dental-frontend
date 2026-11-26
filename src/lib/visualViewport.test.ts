import { expect, test } from 'vitest'

import { panelHeight } from './visualViewport'

test('установленное приложение залипло короче настоящего экрана — карточка до наибольшей высоты', () => {
  expect(panelHeight(760, 852, true, false)).toBe(852)
})

test('дрожание в пару пикселей — высота как есть', () => {
  expect(panelHeight(840, 852, true, false)).toBe(840)
})

test('клавиатура открыта — карточка над клавиатурой, как говорит браузер', () => {
  expect(panelHeight(500, 852, true, true)).toBe(500)
})

test('Safari и Telegram: высота законно меняется (панель адреса) — как есть', () => {
  expect(panelHeight(760, 852, false, false)).toBe(760)
})

test('ещё ничего не мерили — как есть', () => {
  expect(panelHeight(760, 0, true, false)).toBe(760)
})
