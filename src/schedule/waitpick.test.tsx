import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Entry = Schemas['WaitlistView']

/** Телефон: «День» списком, свободное окно — строка «свободно до …». */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
  localStorage.setItem('crm.schedule.view', '1')
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const at = (time: string) => slotInstant(todayIn(), Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))
const person = (id: number, fullName: string) => ({ id, fullName, phone: '996700000' + String(id).padStart(3, '0') })

const aigul: Entry = { id: 1, doctorId: 1, patient: person(21, 'Айгуль Т.'), durationMinutes: 45, createdAt: '2026-10-20T04:00:00Z' }
/** Записан позже в этот же день к этому врачу — хочет раньше */
const bakyt: Entry = { id: 2, patient: person(22, 'Бакыт М.'), durationMinutes: 30, createdAt: '2026-10-21T04:00:00Z',
  upcoming: appointment(90, 1, '16:00', 'Бакыт М.') }
const otherDoctor: Entry = { id: 3, doctorId: 2, patient: person(23, 'Чынара К.'), durationMinutes: 30, createdAt: '2026-10-22T04:00:00Z' }
const tooLong: Entry = { id: 4, doctorId: 1, patient: person(24, 'Дина С.'), durationMinutes: 150, createdAt: '2026-10-23T04:00:00Z' }

function backend(waitlist: Entry[]) {
  const created: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/appointments/counts', () => HttpResponse.json([])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, breaks: [], starts: [at('10:00')],
      free: [{ start: at('10:00'), end: at('12:00') }] })),
    http.get('*/api/waitlist', () => HttpResponse.json(waitlist)),
    http.post('*/api/appointments', async ({ request }) => {
      created.push(await request.json())
      return HttpResponse.json(appointment(55, 1, '10:00', 'Айгуль Т.'), { status: 201 })
    }),
  )
  return created
}

test('свободное окно 10:00–12:00: подходят двое из листа (без записи и с поздней записью), «Записать сюда» выбирает пациента', async () => {
  const created = backend([aigul, bakyt, otherDoctor, tooLong])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Свободно с 10:00 до 12:00, записать/ }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  const box = await within(panel).findByRole('region', { name: 'Подходит из листа ожидания' })
  expect(box).toHaveTextContent('Айгуль Т.')
  expect(box).toHaveTextContent('без записи')
  expect(box).toHaveTextContent('Бакыт М.')
  // Чынара ждёт другого врача, Дине нужно 2,5 часа — в окно не помещается
  expect(box).not.toHaveTextContent('Чынара')
  expect(box).not.toHaveTextContent('Дина')
  // Уже записан позже — не вторая запись, а перенос той
  expect(within(box).getByRole('button', { name: 'Перенести сюда' })).toBeInTheDocument()

  await userEvent.click(within(box).getByRole('button', { name: 'Записать сюда' }))
  expect(within(panel).queryByRole('region', { name: 'Подходит из листа ожидания' })).not.toBeInTheDocument()
  expect(within(panel).getByText('Айгуль Т.')).toBeInTheDocument()
  expect(panel).toHaveTextContent('из листа ожидания')
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
  // Длительность — из листа; fromWaitlistId — сервер уберёт строку листа той же транзакцией
  expect(created).toEqual([expect.objectContaining({ patientId: 21, doctorId: 1, startAt: at('10:00'), durationMinutes: 45, fromWaitlistId: 1 })])
})

test('выбрали из листа, потом «Другой» — обычная запись, лист не трогаем', async () => {
  const created = backend([aigul])
  server.use(http.post('*/api/patients/search', () => HttpResponse.json([person(30, 'Эрмек Ж.')])))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Свободно с 10:00 до 12:00, записать/ }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Записать сюда' }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Другой' }))
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Эрм')
  await userEvent.click(await within(panel).findByRole('button', { name: /Эрмек Ж\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
  expect(created[0]).not.toHaveProperty('fromWaitlistId')
})

test('никто из листа не помещается — блока нет совсем', async () => {
  backend([otherDoctor, tooLong])
  let asked = 0
  server.use(http.get('*/api/waitlist', () => { asked++; return HttpResponse.json([otherDoctor, tooLong]) }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Свободно с 10:00 до 12:00, записать/ }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  expect(await within(panel).findByRole('group', { name: 'Свободное время' })).toBeInTheDocument()
  await vi.waitFor(() => expect(asked).toBeGreaterThan(0))
  expect(within(panel).queryByRole('region', { name: 'Подходит из листа ожидания' })).not.toBeInTheDocument()
  expect(panel).not.toHaveTextContent(/Чынара|Дина/)
})
