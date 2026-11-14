import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { slotInstant } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Общее кресло (V185) в «Расписании» на компьютере. Врачи — вымышленные. */
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

function backend(created: () => Response) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
    http.get('*/api/chairs', () => HttpResponse.json([{ id: 5, name: 'Кресло 1', doctorIds: [1, 2], overlaps: [] }] satisfies Schemas['ChairOverview'][])),
    http.get('*/api/slots', ({ request }) => {
      const url = new URL(request.url)
      const date = url.searchParams.get('date')!
      const doctorId = Number(url.searchParams.get('doctorId'))
      // У Дастана 10:00–11:00 кресло занято Айгерим: свободно — до и после
      return HttpResponse.json({
        workingDay: true, workStart: '09:00:00', workEnd: '18:00:00', breaks: [],
        starts: doctorId === 2 ? [slotInstant(date, 9 * 60)] : [],
        free: doctorId === 2 ? [{ start: slotInstant(date, 9 * 60), end: slotInstant(date, 10 * 60) }, { start: slotInstant(date, 11 * 60), end: slotInstant(date, 18 * 60) }] : [],
        chairBusy: doctorId === 2 ? [{ start: slotInstant(date, 10 * 60), end: slotInstant(date, 11 * 60), chairName: 'Кресло 1', doctorId: 1, doctorName: 'Айгерим Садыкова' }] : [],
      } satisfies Schemas['SlotsView'])
    }),
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Нурлан К.', phone: '996700111222' }])),
    http.post('*/api/appointments', created),
  )
}

test('шапка колонки — «Кресло 1» (значок кресла) с подсказкой, с кем общее; время, когда кресло у коллеги, — штриховкой и без записи', async () => {
  backend(() => HttpResponse.json({}, { status: 500 }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))

  const badge = await screen.findByLabelText('Кресло 1, делит кресло с: Айгерим Садыкова')
  expect(badge).toHaveTextContent('Кресло 1')
  expect(badge).toHaveAttribute('title', 'делит кресло с: Айгерим Садыкова')
  expect(screen.getByLabelText('Кресло 1, делит кресло с: Дастан Т.')).toBeInTheDocument()

  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  const busy = await within(column).findByRole('note', { name: '10:00–11:00: кресло занято (Айгерим Садыкова)' })
  expect(busy).toHaveTextContent('🪑 кресло занято (Айгерим Садыкова)')
  expect(busy).toHaveClass('grid-chair')
  // Не свободно: окна «Свободно» — до и после, а нажатие на полосу не открывает «Новую запись»
  expect(within(column).getByRole('button', { name: 'Свободно с 09:00 до 10:00, записать' })).toBeInTheDocument()
  expect(within(column).getByRole('button', { name: 'Свободно с 11:00 до 18:00, записать' })).toBeInTheDocument()
  await userEvent.click(busy)
  expect(screen.queryByRole('complementary', { name: 'Новая запись' })).not.toBeInTheDocument()
})

test('сервер ответил «кресло занято» (409) — текст с креслом и врачом под временем', async () => {
  const detail = 'Кресло занято: «Кресло 1» в это время у врача Айгерим Садыкова'
  backend(() => HttpResponse.json({ title: 'Conflict', status: 409, detail, code: 'time-taken' }, { status: 409 }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  const column = await screen.findByRole('group', { name: 'Дастан Т.' })
  await userEvent.click(await within(column).findByRole('button', { name: 'Свободно с 09:00 до 10:00, записать' }))
  const panel = await screen.findByRole('complementary', { name: 'Новая запись' })
  await within(panel).findByRole('group', { name: 'Свободное время' })
  await userEvent.type(within(panel).getByLabelText('Найти пациента'), 'Нур')
  await userEvent.click(await within(panel).findByRole('button', { name: /Нурлан К\./ }))
  await userEvent.click(within(panel).getByRole('button', { name: 'Записать' }))

  await waitFor(() => expect(within(panel).getByRole('alert')).toHaveTextContent(detail))
})
