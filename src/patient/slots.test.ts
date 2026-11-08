import { partOfDay } from './slots'

test('ночные начала (ночная смена врача) — отдельной частью «Ночь», а не «Утро»', () => {
  expect(partOfDay('00:15')).toBe('night')
  expect(partOfDay('05:45')).toBe('night')
  expect(partOfDay('06:00')).toBe('morning')
  expect(partOfDay('12:00')).toBe('afternoon')
  expect(partOfDay('23:45')).toBe('evening')
})
