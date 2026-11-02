import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

const DAY = '2026-11-02'

/** Часы — 10:47 по Бишкеку: время «сейчас» не кратно 5 минутам. Таймеры — настоящие, подменяем только дату. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${DAY}T10:47:00+06:00`))
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

function backend(starts: string[] = ['11:00', '11:30']) {
  const created: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({
      workingDay: true, breaks: [], free: [],
      starts: starts.map((t) => slotInstant(todayIn(), Number(t.slice(0, 2)) * 60 + Number(t.slice(3)))),
    })),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Нурлан К.', phone: '996700111222' }])),
    http.post('*/api/appointments', async ({ request }) => {
      created.push(await request.json())
      return HttpResponse.json(appointment(99, 1, '10:45', 'Нурлан К.'), { status: 201 })
    }),
  )
  return created
}

test('«Принять сейчас» в 10:47 — время 10:45: поле с шагом 5 минут не мешает отправить форму', async () => {
  const created = backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Принять сейчас' }))
  const panel = screen.getByRole('complementary', { name: 'Принять сейчас' })
  const time = within(panel).getByLabelText('Время')
  expect(time).toHaveValue('10:45')
  expect((time as HTMLInputElement).checkValidity()).toBe(true)
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Начать приём' }))
  expect(await screen.findByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
  expect(created).toEqual([expect.objectContaining({ startAt: slotInstant(DAY, 10 * 60 + 45) })])
})

test('«＋ Новая запись» — время не подставлено (не 09:00, которое прошло): сетка свободного', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  const grid = await within(panel).findByRole('group', { name: 'Свободное время' })
  expect(within(grid).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
  expect(within(panel).queryByLabelText('Время', { selector: 'input' })).not.toBeInTheDocument()
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))
  expect(within(panel).getByRole('alert')).toHaveTextContent('Выберите время')
})

test('время не кратно 5 (окно после приёма в 10:47) — ручной ввод принимает его', async () => {
  backend([])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
  const panel = screen.getByRole('complementary', { name: 'Новая запись' })
  await userEvent.click(await within(panel).findByRole('button', { name: 'Другое время' }))
  const time = within(panel).getByLabelText('Время', { selector: 'input' }) as HTMLInputElement
  await userEvent.type(time, '12:47')
  expect(time.step).toBe('60')
  expect(time.checkValidity()).toBe(true)
})
