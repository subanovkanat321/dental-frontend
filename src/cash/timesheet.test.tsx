import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { daysText } from './daysText'
import { waitForSlow } from '../test/wait'

// «Оклад по табелю» (V182 бэкенда). Сотрудники вымышленные; считает сервер — тест отвечает его числами
type Row = Schemas['SalaryControllerSalaryRow']
type Sheet = Schemas['TimesheetControllerView']
type Day = Schemas['TimesheetsDay']

/** Март 2026: Пн–Пт рабочие, всё отработано; 10-е — больничный вручную. */
function march(sick: string[] = []): Day[] {
  return Array.from({ length: 31 }, (_, i) => {
    const date = `2026-03-${String(i + 1).padStart(2, '0')}`
    const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
    const planned = weekday < 5
    if (sick.includes(date)) return { date, planned, mark: 'SICK', manual: true }
    return { date, planned, mark: planned ? 'WORKED' : undefined, manual: false }
  })
}

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

test('склонение дней', () => {
  expect([1, 2, 5, 11, 21, 22].map((n) => `из ${n} ${daysText(n)}`)).toEqual(['из 1 дня', 'из 2 дней', 'из 5 дней', 'из 11 дней', 'из 21 дня', 'из 22 дней'])
})

test('оклад по табелю: расшифровка в карточке, табель, больничный кистью, норма вручную', async () => {
  let row: Row = { assistantId: 7303, doctor: 'Айпери', position: 'регистратура', percent: 0, baseSom: 30000, revenueSom: 0,
    dueSom: 30000, paidSom: 0, byTimesheet: true, workedDays: 22, normDays: 22, baseAccruedSom: 30000, former: false, earnedSom: 0, rentFixedSom: 0, rentSom: 0, owesSom: 0, rentReceivedSom: 0 }
  let sheet: Sheet = { month: '2026-03', telegramId: 7303, baseSom: 30000, byTimesheet: true, accruedSom: 30000, normDays: 22,
    normManual: false, plannedDays: 22, workedDays: 22, days: march() }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([row])),
    http.get('*/api/salaries/timesheet', () => HttpResponse.json(sheet)),
    http.put('*/api/salaries/timesheet/day', async ({ request }) => {
      sent.push(await request.json())
      sheet = { ...sheet, workedDays: 21, accruedSom: 28636, days: march(['2026-03-10']) }
      row = { ...row, workedDays: 21, baseAccruedSom: 28636, dueSom: 28636 }
      return HttpResponse.json(sheet)
    }),
    http.put('*/api/salaries/timesheet/norm', async ({ request }) => {
      sent.push(await request.json())
      sheet = { ...sheet, normDays: 21, normManual: true, accruedSom: 30000 }
      return HttpResponse.json(sheet)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  const card = await screen.findByRole('region', { name: 'Зарплата: Айпери' })
  expect(card).toHaveTextContent('Условия: оклад 30 000 сом по табелю')
  expect(within(card).getByLabelText('Оклад по табелю')).toHaveTextContent(/Отработано 22 из 22 дней → 30\s000 сом из оклада 30\s000 сом/)

  await user.click(within(card).getByRole('button', { name: 'Табель — отметить дни' }))
  const grid = await within(card).findByRole('grid', { name: 'Дни месяца' })
  // 1 марта 2026 — воскресенье: шесть пустых клеток, потом выходной
  expect(within(grid).getByRole('gridcell', { name: '1: нерабочий' })).toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: 'Больничный' }))
  await user.click(within(grid).getByRole('gridcell', { name: '10: Отработан' }))
  expect(await within(grid).findByRole('gridcell', { name: '10: Больничный (вручную)' })).toBeInTheDocument()
  expect(sent[0]).toEqual({ telegramId: 7303, date: '2026-03-10', mark: 'SICK' })
  // Карточка зарплаты пересчиталась с сервера
  expect(await within(card).findByLabelText('Оклад по табелю')).toHaveTextContent(/21 из 22 дней → 28\s636 сом/)

  await user.type(within(card).getByLabelText('Норма дней в месяце'), '21')
  await user.click(within(card).getByRole('button', { name: 'Задать норму' }))
  await waitForSlow(() => expect(within(card).getByLabelText('Норма дней в месяце')).toHaveValue('21'))
  expect(sent[1]).toEqual({ telegramId: 7303, month: expect.stringMatching(/^\d{4}-\d{2}$/), days: 21 })
})

test('условия: галочка «оклад по табелю» уходит на сервер', async () => {
  const row: Row = { doctorId: 2, doctor: 'Дастан Т.', percent: 0, baseSom: 0, revenueSom: 0, dueSom: 0, paidSom: 0, former: false, earnedSom: 0, rentFixedSom: 0, rentSom: 0, owesSom: 0, rentReceivedSom: 0, byTimesheet: false, baseAccruedSom: 0 }
  let sent: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/salaries', () => HttpResponse.json([row])),
    http.put('*/api/salaries/2', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ ...row, baseSom: 30000, byTimesheet: true, workedDays: 20, normDays: 22, baseAccruedSom: 27273, dueSom: 27273 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Зарплата'))
  const card = await screen.findByRole('region', { name: 'Зарплата: Дастан Т.' })
  await user.click(within(card).getByRole('button', { name: '⚙️ Задать процент и оклад' }))
  // Галочка — только когда есть оклад
  expect(within(card).queryByRole('checkbox', { name: /Оклад по табелю/ })).not.toBeInTheDocument()
  await user.type(within(card).getByLabelText('Оклад в месяц, сом'), '30000')
  await user.click(within(card).getByRole('checkbox', { name: /Оклад по табелю/ }))
  await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(sent).toMatchObject({ baseSom: 30000, byTimesheet: true, percent: 0 }))
})
