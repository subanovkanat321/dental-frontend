import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  window.location.hash = ''
  localStorage.clear()
})

const today = todayIn()
const row = (id: number, patient: string, day: string, extra: Partial<Schemas['AppointmentServiceReportRow']> = {}) => ({
  id, patient, doctor: 'Айгерим Садыкова', startAt: slotInstant(day, 600), status: 'Состоялся', paidSom: 1000, method: 'CASH', ...extra,
}) satisfies Schemas['AppointmentServiceReportRow']

test('касса: последние оплаты — новые сверху; сортировка по сумме; фильтр «только с долгом»', async () => {
  window.location.hash = '/cash'
  // Начало месяца — чтобы три дня точно попали в «Месяц»
  const d1 = `${today.slice(0, 7)}-01`
  const d2 = today >= `${today.slice(0, 7)}-02` ? `${today.slice(0, 7)}-02` : d1
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/appointments/report', () => HttpResponse.json([
      row(1, 'Старый Пациент', d1, { paidSom: 5000, startAt: slotInstant(d1, 540) }),
      row(2, 'Новый Пациент', today, { paidSom: 1500, method: 'CARD', startAt: slotInstant(today, 1000) }),
      row(3, 'Должник Тестов', d2, { paidSom: 500, debtSom: 2000 }),
    ])),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Последние оплаты' })
  const names = () => within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent)
  expect(names()[0]).toBe('Новый Пациент')

  await user.click(within(table).getByRole('button', { name: 'Оплачено' }))
  expect(names()[0]).toBe('Старый Пациент')

  await user.click(screen.getByRole('checkbox', { name: 'Только с долгом' }))
  expect(names()).toEqual(['Должник Тестов'])
  await user.click(screen.getByRole('checkbox', { name: 'Только с долгом' }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Способ оплаты' }), 'CARD')
  expect(names()).toEqual(['Новый Пациент'])
})

test('долги: по умолчанию новые сверху, нажать «Долг» — большие сверху', async () => {
  window.location.hash = '/cash'
  const debt = (id: number, patient: string, day: string, sum: number) => ({
    appointmentId: id, patient, doctor: 'Айгерим Садыкова', startAt: slotInstant(day, 600), debtSom: sum,
  }) satisfies Schemas['PaymentQueryDebt']
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([
      debt(1, 'Давний', addDays(today, -30), 9000), debt(2, 'Вчерашний', addDays(today, -1), 1000),
    ])),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Долги пациентов' })
  const first = () => within(within(table).getAllByRole('row')[1]!).getAllByRole('cell')[0]!.textContent
  expect(first()).toBe('Вчерашний')
  await user.click(within(table).getByRole('button', { name: 'Долг' }))
  expect(first()).toBe('Давний')
})

test('расписание: «Все врачи» или один врач, выбор запоминается', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1'
      ? [appointment(10, 1, '10:00', 'Бакыт М.')] : [appointment(20, 2, '11:00', 'Айгуль Т.')])),
  )
  const user = userEvent.setup()
  renderApp()
  const views = await screen.findByRole('group', { name: 'Чьё расписание' })
  expect(await screen.findByRole('button', { name: /Айгуль Т\./ })).toBeInTheDocument()
  await user.click(within(views).getByRole('button', { name: 'Дастан Т.' }))
  expect(screen.queryByRole('button', { name: /Бакыт М\./ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Айгуль Т\./ })).toBeInTheDocument()
  expect(localStorage.getItem('crm.schedule.view')).toBe('2')
  await user.click(within(views).getByRole('button', { name: 'Все врачи' }))
  expect(screen.getByRole('button', { name: /Бакыт М\./ })).toBeInTheDocument()
})
