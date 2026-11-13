import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// Компьютер: сетка дня, «Неделя» и «Месяц»
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

test('вернулись с «Недели» на «День» — сетка снова прокручена к приёмам, а не с 00:00', async () => {
  const visit: Schemas['AppointmentView'] = {
    id: 1, doctorId: 1, startAt: slotInstant(tomorrow, 15 * 60), endAt: slotInstant(tomorrow, 15 * 60 + 30), status: 'SCHEDULED',
    reply: 'NONE', version: 1, patient: { id: 1, fullName: 'Бакыт М.', phone: '996555000111', telegram: false }, source: 'DOCTOR', debtSom: 0, chairManual: false, firstVisit: false
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('date') === tomorrow ? [visit] : [])),
    http.get('*/api/appointments/range', () => HttpResponse.json([])),
    http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, workStart: '00:00:00', workEnd: '23:00:00', breaks: [], free: [],
      work: [{ start: slotInstant(tomorrow, 0), end: slotInstant(tomorrow, 23 * 60) }] } satisfies Schemas['SlotsView'])),
  )
  const { container } = renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Следующий день' }))
  await screen.findAllByRole('button', { name: /Бакыт М\./ })
  const grid = () => container.querySelector<HTMLElement>('.grid')!
  await waitFor(() => expect(grid().scrollTop).toBeGreaterThan(0))

  await userEvent.click(screen.getByRole('button', { name: 'Неделя' }))
  await userEvent.click(screen.getByRole('button', { name: 'День' }))
  await screen.findAllByRole('button', { name: /Бакыт М\./ })
  await waitFor(() => expect(grid().scrollTop).toBeGreaterThan(0))
})
