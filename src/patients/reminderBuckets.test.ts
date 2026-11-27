import type { Schemas } from '../api/client'
import { bucketCounts, bucketOf, runLimited } from './reminderBuckets'

type Appointment = Schemas['AppointmentView']

const base: Appointment = {
  id: 1, doctorId: 1, startAt: '2030-01-01T04:00:00Z', endAt: '2030-01-01T04:30:00Z', status: 'SCHEDULED', reply: 'NONE', version: 0,
  source: 'DOCTOR', debtSom: 0, firstVisit: false, chairManual: false, lockedForDoctors: false,
  patient: { id: 1, fullName: 'Тест Т.', phone: '996555000111', telegram: false },
}
const at = '2029-12-31T10:00:00Z'

test('корзины обзвона: подтвердили, напомнили (WhatsApp, бот за 2 часа, ответ без «приду»), не напомнили, нет контакта', () => {
  expect(bucketOf({ ...base, reply: 'CONFIRMED' })).toBe('confirmed')
  expect(bucketOf({ ...base, reminderOpenedAt: at })).toBe('reminded')
  expect(bucketOf({ ...base, soonRemindedAt: at })).toBe('reminded')
  expect(bucketOf({ ...base, reply: 'NO_ANSWER' })).toBe('reminded')
  expect(bucketOf(base)).toBe('todo')
  // Только бот, без номера — напомнить есть куда
  expect(bucketOf({ ...base, patient: { id: 1, fullName: 'Т', telegram: true } })).toBe('todo')
  expect(bucketOf({ ...base, patient: { id: 1, fullName: 'Т', telegram: false } })).toBe('nowhere')
  // Заявку сначала подтверждают
  expect(bucketOf({ ...base, status: 'REQUESTED' })).toBeNull()
  expect(bucketCounts([base, { ...base, reply: 'CONFIRMED' }, { ...base, status: 'DONE' }])).toEqual({ confirmed: 1, reminded: 0, todo: 1, nowhere: 0 })
})

test('runLimited: не больше limit одновременно, ошибки считает, остальное делает', async () => {
  let running = 0
  let peak = 0
  const failed = await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    if (n % 3 === 0) throw new Error('x')
  })
  expect(peak).toBe(3)
  expect(failed).toBe(2)
})
