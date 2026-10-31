import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { periodOf, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

const debt = (id: number, patient: string, extra: Partial<Schemas['PaymentQueryDebt']> = {}) => ({
  appointmentId: id, patient, doctorId: 1, doctor: 'Айгерим Садыкова', startAt: `${todayIn()}T04:00:00Z`, ...extra,
}) satisfies Schemas['PaymentQueryDebt']

test('периоды: неделя — с понедельника, месяц — с 1-го', () => {
  expect(periodOf('week', '2026-10-31')).toEqual({ from: '2026-10-26', to: '2026-10-31' }) // суббота
  expect(periodOf('week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-10-26' }) // понедельник
  expect(periodOf('month', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
})

test('админ: выручка за месяц, по способам; выбрать врача — его касса; долги таблицей', async () => {
  const asked: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/revenue', ({ request }) => {
      const q = new URL(request.url).searchParams
      asked.push(`${q.get('from')}..${q.get('to')} ${q.get('doctorId') ?? 'все'}`)
      return HttpResponse.json({
        totalSom: q.get('doctorId') ? 7000 : 25000, paidCount: 6, unpaidCount: 1, byMethod: { CASH: 15000, TRANSFER: 10000 },
        days: [{ date: '2026-10-01', totalSom: 5000 }, { date: '2026-10-02', totalSom: 20000 }],
      } satisfies Schemas['RevenueView'])
    }),
    http.get('*/api/appointments/debts', () => HttpResponse.json([debt(7, 'Бакыт М.', { debtSom: 2000, dueOn: '2020-01-01' })])),
  )
  renderApp()
  expect(await screen.findByLabelText('Выручка за период')).toHaveTextContent(/25\s000 сом/)
  expect(screen.getByText(/Наличные: 15\s000 сом/)).toBeInTheDocument()
  expect(screen.getByText(/без оплаты: 1/)).toBeInTheDocument()
  const month = periodOf('month')
  expect(asked).toContain(`${month.from}..${month.to} все`)

  await userEvent.selectOptions(screen.getByLabelText('Чья касса'), 'Дастан Т.')
  expect(await screen.findByLabelText('Выручка за период')).toHaveTextContent(/7\s000 сом/)
  expect(asked.at(-1)).toBe(`${month.from}..${month.to} 2`)

  await userEvent.click(screen.getByRole('button', { name: 'Сегодня' }))
  await screen.findByLabelText('Выручка за период')
  expect(asked.at(-1)).toBe(`${todayIn()}..${todayIn()} 2`)

  const debts = screen.getByRole('table', { name: 'Долги пациентов' })
  expect(debts).toHaveTextContent('Бакыт М.')
  expect(debts).toHaveTextContent(/2\s000 сом/)
  // «К оплате» — только где есть регистратура
  expect(screen.queryByRole('heading', { name: /К оплате на кассе/ })).not.toBeInTheDocument()
})

test('регистратура: «К оплате на кассе» — нажать, принять оплату в карточке, строка уходит', async () => {
  let waiting = [debt(30, 'Айгуль Т.', { chargeSom: 4000 })]
  let paid: unknown
  const billed = appointment(30, 1, '09:00', 'Айгуль Т.', { status: 'DONE', chargeSom: 4000, version: 2 })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined, hasReception: true })),
    http.get('*/api/appointments/to-pay', () => HttpResponse.json(waiting)),
    http.get('*/api/appointments/30', () => HttpResponse.json(billed)),
    http.post('*/api/appointments/30/payment', async ({ request }) => {
      paid = await request.json()
      waiting = []
      return HttpResponse.json({ ...billed, paidSom: 4000, paymentMethod: 'CASH', version: 3 })
    }),
  )
  renderApp()
  const table = await screen.findByRole('table', { name: 'К оплате на кассе' })
  expect(table).toHaveTextContent(/4\s000 сом/)
  // Регистратура не видит выручку и долги врачей
  expect(screen.queryByRole('heading', { name: 'Выручка' })).not.toBeInTheDocument()

  await userEvent.click(within(table).getByRole('button', { name: 'Айгуль Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).getByLabelText('Сумма, сом')).toHaveValue(4000)
  await userEvent.click(within(panel).getByRole('button', { name: 'Принять оплату' }))

  expect(await screen.findByText('Никто не ждёт оплаты')).toBeInTheDocument()
  expect(paid).toEqual({ amountSom: 4000, method: 'CASH' })
})
