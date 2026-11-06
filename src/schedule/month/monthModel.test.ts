import type { Schemas } from '../../api/client'
import { addMonths, monthGridDays, monthTitle, recordsText, workDayOf } from './monthModel'

const hours: Schemas['DoctorHoursView'] = { custom: true, days: [
  { weekday: 'MONDAY', start: '09:00:00', end: '18:00:00' },
  { weekday: 'TUESDAY', start: '10:00:00', end: '14:00:00' },
] }

test('сетка месяца — с понедельника по воскресенье, целыми неделями', () => {
  // Ноябрь 2026: 1-е — воскресенье, 30-е — понедельник → с 26 октября по 6 декабря, 6 недель
  const days = monthGridDays('2026-11')
  expect(days[0]).toBe('2026-10-26')
  expect(days.at(-1)).toBe('2026-12-06')
  expect(days).toHaveLength(42)
  expect(monthTitle('2026-11')).toBe('Ноябрь 2026')
  expect(addMonths('2026-12', 1)).toBe('2027-01')
  expect(addMonths('2026-01', -1)).toBe('2025-12')
})

test('рабочие минуты: недельный график, перерыв вычитается, выходной на весь день — нерабочий', () => {
  const monday = '2026-11-02'
  const tuesday = '2026-11-03'
  expect(workDayOf(monday, 1, hours, [])).toEqual({ off: false, minutes: 540 })
  expect(workDayOf('2026-11-04', 1, hours, [])).toEqual({ off: true, minutes: 0 })
  expect(workDayOf(monday, 1, undefined, [])).toBeNull()
  const lunch: Schemas['TimeOffView'] = { id: 1, doctorId: 1, weekday: 'MONDAY', startTime: '13:00:00', endTime: '14:00:00', title: 'Обед' }
  expect(workDayOf(monday, 1, hours, [lunch])).toEqual({ off: false, minutes: 480 })
  // Чужой перерыв не считается; перерыв вне рабочих часов — тоже
  expect(workDayOf(monday, 2, hours, [lunch])?.minutes).toBe(540)
  const late: Schemas['TimeOffView'] = { id: 2, weekday: 'TUESDAY', startTime: '15:00:00', endTime: '16:00:00' }
  expect(workDayOf(tuesday, 1, hours, [late])?.minutes).toBe(240)
  const holiday: Schemas['TimeOffView'] = { id: 3, firstDay: '2026-11-01', lastDay: '2026-11-02', title: 'Праздник', emoji: '🎉' }
  expect(workDayOf(monday, 1, hours, [holiday])).toEqual({ off: true, offTitle: '🎉 Праздник', minutes: 0 })
  expect(workDayOf(tuesday, 1, hours, [holiday])?.off).toBe(false)
})

test('«N записей» по-русски', () => {
  expect([1, 2, 5, 11, 12, 21, 22, 25].map(recordsText)).toEqual(
    ['1 запись', '2 записи', '5 записей', '11 записей', '12 записей', '21 запись', '22 записи', '25 записей'])
})
