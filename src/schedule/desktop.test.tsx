import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { addDays, slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Широкий экран компьютера: min-width-запросы совпадают, телефонные (max-width) — нет. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {}, onchange: null,
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const tomorrow = addDays(todayIn(), 1)

function backend() {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => {
      const url = new URL(request.url)
      const doctorId = Number(url.searchParams.get('doctorId'))
      if (url.searchParams.get('date') !== tomorrow || doctorId !== 1) return HttpResponse.json([])
      return HttpResponse.json([appointment(10, 1, '10:00', 'Бакыт М.', { startAt: slotInstant(tomorrow, 600), endAt: slotInstant(tomorrow, 630), status: 'REQUESTED' })])
    }),
    http.get('*/api/slots', ({ request }) => {
      const url = new URL(request.url)
      const date = url.searchParams.get('date')!
      const doctorId = Number(url.searchParams.get('doctorId'))
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        free: doctorId === 1 ? [{ start: slotInstant(date, 13 * 60), end: slotInstant(date, 18 * 60) }] : [],
      })
    }),
  )
}

test('компьютер: свободное окно в колонке врача — «Свободно 13:00–18:00», нажать — новая запись на 13:00', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Айгерим Садыкова' })
  const free = await within(column).findByRole('button', { name: 'Свободно с 13:00 до 18:00, записать' })
  expect(free).toHaveTextContent('Свободно 13:00–18:00＋ записать')
  await userEvent.click(free)
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()
})

test('компьютер: сводка дня справа — первый приём, заявки, свободное время врачей', async () => {
  backend()
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const summary = await screen.findByRole('complementary', { name: 'Сводка дня' })
  expect(await within(summary).findByRole('button', { name: /10:00–10:30\s*Бакыт М\./ })).toBeInTheDocument()
  // Ряд «Требует внимания» — здесь столбиком, над сеткой его нет
  const attention = within(summary).getByRole('group', { name: 'Требует внимания' })
  expect(within(attention).getByRole('button', { name: /1 заявка из бота/ })).toBeInTheDocument()
  expect(screen.getAllByRole('group', { name: 'Требует внимания' })).toHaveLength(1)
  expect(within(summary).getByText('5 ч свободно')).toBeInTheDocument()
  await userEvent.click(within(summary).getByRole('button', { name: 'Записать к врачу Айгерим Садыкова на 13:00' }))
  // Карточка «Новая запись» встаёт на место сводки
  expect(await screen.findByRole('complementary', { name: 'Новая запись' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Сводка дня' })).not.toBeInTheDocument()
})
