import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

test('аналитика: выручка по месяцам, по врачам, по услугам, доля неявок', async () => {
  const thisMonth = todayIn().slice(0, 7)
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/revenue', ({ request }) => {
      const q = new URL(request.url).searchParams
      const doctor = q.get('doctorId')
      // Текущий месяц — 50 000, прошлые — 40 000; по врачам — 30 000 и 20 000
      const total = doctor ? (doctor === '1' ? 30000 : 20000) : q.get('from')!.startsWith(thisMonth) ? 50000 : 40000
      return HttpResponse.json({ totalSom: total, paidCount: 5, unpaidCount: 0, byMethod: {}, days: [] } satisfies Schemas['RevenueView'])
    }),
    // Отчёт — по месяцам: строки только за запрошенный месяц (30 дней могут захватить два)
    http.get('*/api/appointments/report', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('month') !== thisMonth ? [] : [
      { id: 1, startAt: `${todayIn()}T04:00:00Z`, patient: 'Бакыт М.', doctor: 'Айгерим', service: 'Пломба', status: 'DONE', paidSom: 3000 },
      { id: 2, startAt: `${todayIn()}T05:00:00Z`, patient: 'Нурлан К.', doctor: 'Айгерим', service: 'Пломба', status: 'DONE', paidSom: 3000 },
      { id: 3, startAt: `${todayIn()}T06:00:00Z`, patient: 'Асель У.', doctor: 'Дастан', service: 'Чистка', status: 'DONE', paidSom: 2000 },
    ] satisfies Schemas['AppointmentServiceReportRow'][])),
    http.get('*/api/appointments/stats', () => HttpResponse.json([
      { weekStart: '2026-10-26', booked: 10, done: 9, noShow: 1, cancelled: 0 },
      { weekStart: '2026-10-19', booked: 10, done: 7, noShow: 3, cancelled: 1 },
    ] satisfies Schemas['WeekStats'][])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Аналитика' }))

  const months = await screen.findByRole('region', { name: 'Выручка за 6 месяцев' })
  // Главная цифра — последний полный месяц (текущий идёт): 40 000, как месяцем раньше
  expect(await within(months).findByText(/как было/)).toBeInTheDocument()
  expect(within(months).getByRole('img').getAttribute('aria-label')).toMatch(/50\s000 сом$/)

  const doctors = await screen.findByRole('region', { name: 'Выручка по врачам' })
  const rows = await within(doctors).findAllByRole('listitem')
  expect(rows[0]).toHaveTextContent(/Айгерим Садыкова.*30\s000 сом.*60%/)

  const services = screen.getByRole('region', { name: 'Выручка по услугам' })
  expect((await within(services).findAllByRole('listitem'))[0]).toHaveTextContent(/Пломба.*6\s000 сом.*75%/)

  const noShow = screen.getByRole('region', { name: 'Неявки по неделям' })
  expect(await within(noShow).findByText('20%')).toBeInTheDocument() // 4 неявки из 20
})
