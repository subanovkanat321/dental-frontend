import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { saveCsv } from '../lib/csv'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'

vi.mock('../lib/csv', () => ({ saveCsv: vi.fn() }))

type Me = Schemas['BookingViewsMe']
type Row = Schemas['NetMonthRow']

/** Вымышленные врачи и суммы — как посчитал бы NetMonth на сервере. */
const DASTAN: Row = {
  doctorId: 2, doctor: 'Дастан Т.', selfEmployed: true, revenueSom: 50000, earnedSom: 50000, rentSom: 20000, materialsSom: 300,
  unpricedMaterials: 1, expensesSom: 4000, doctorNetSom: 25700, clinicSom: 20000, sharedSom: 10000, clinicAfterSharedSom: 10000,
}
const BERMET: Row = {
  doctorId: 3, doctor: 'Бермет К.', selfEmployed: false, revenueSom: 40000, earnedSom: 22000, rentSom: 0, materialsSom: 200,
  unpricedMaterials: 0, expensesSom: 3000, clinicSom: 14800, sharedSom: 8000, clinicAfterSharedSom: 6800,
}
const TOTAL: Row = {
  doctor: 'Итого по врачам', selfEmployed: true, revenueSom: 90000, earnedSom: 72000, rentSom: 20000, materialsSom: 500,
  unpricedMaterials: 1, expensesSom: 7000, doctorNetSom: 25700, clinicSom: 34800, sharedSom: 18000, clinicAfterSharedSom: 16800,
}
const REPORT: Schemas['NetMonthReport'] = {
  month: '2026-10', rows: [DASTAN, BERMET], total: TOTAL, generalExpensesSom: 18000, purchasedSom: 1000, clinicMaterialsSom: 200,
  supplySom: -800, selfEmployedExpensesSom: 4000, accruedSom: 52000, paidSom: 31000, rentReceivedSom: 0, payoutsSom: 21000, otherSom: 0,
  profitSom: 33000,
}

const doctorOnly: Me = { ...me, admin: false, doctorId: 2 }

function backend(who: Me, mine: Schemas['NetMonthMine']) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/me/earnings', () => HttpResponse.json({
      date: '2026-11-18', month: '2026-11', hasTerms: true, percent: 100, baseSom: 0, todaySom: 0, todayRevenueSom: 0, monthSom: 30000,
      monthRevenueSom: 50000, previousMonthSom: 0, workDaysLeft: 9, eveningSummary: true, rentSom: 20000,
    } satisfies Schemas['EarningsView'])),
    http.get('*/api/me/net-month', () => HttpResponse.json(mine)),
    http.get('*/api/expenses', () => HttpResponse.json([])),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: [], own: [] })),
    http.get('*/api/supplies/spending', () => HttpResponse.json({ revenueSom: 90000, purchasedSom: 1000, expensesSom: 56000, usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0 } satisfies Schemas['SpendingView'])),
    http.get('*/api/finance/net-month', () => HttpResponse.json(REPORT)),
  )
}

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

test('частный врач: «Чистыми за месяц» столбиком в «Моём заработке»', async () => {
  backend(doctorOnly, { month: '2026-11', row: DASTAN })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))

  const block = await screen.findByRole('region', { name: 'Чистыми за месяц' })
  expect(block).toHaveTextContent('Чистыми за ноябрь')
  expect(block).toHaveTextContent(/Выручка50\s000 сом/)
  expect(block).toHaveTextContent(/Аренда кресла−20\s000 сом/)
  expect(block).toHaveTextContent(/Материалы ≈−300 сом/)
  expect(block).toHaveTextContent(/Техник и лаборатория−4\s000 сом/)
  expect(within(block).getByLabelText('Чистыми')).toHaveTextContent(/25\s700 сом/)
  expect(block).toHaveTextContent('У 1 материала нет цены')
  // 100% — строки «клинике по условиям» нет
  expect(block).not.toHaveTextContent('Клинике по условиям')
})

test('врач за клинику: в «Моём заработке» о марже клиники ничего', async () => {
  backend({ ...doctorOnly, doctorId: 3 }, { month: '2026-11' })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))

  await screen.findByRole('region', { name: 'Мой заработок' })
  expect(screen.queryByRole('region', { name: 'Чистыми за месяц' })).toBeNull()
  expect(screen.queryByText(/Клинике остаётся/)).toBeNull()
})

test('админ: «Итог месяца по врачам» в «Расходах» — строки, итого, сверка с прибылью и CSV', async () => {
  backend(me, { month: '2026-11' })
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))

  const table = await screen.findByRole('table', { name: 'Итог месяца по врачам' })
  const rows = within(table).getAllByRole('row')
  expect(rows).toHaveLength(4)
  expect(rows[1]).toHaveTextContent('Дастан Т.работает сам (аренда)')
  expect(rows[1]).toHaveTextContent(/аренда 20\s000 сом/)
  expect(rows[1]).toHaveTextContent('+1 без цены')
  expect(rows[1]).toHaveTextContent(/25\s700 сом/)
  expect(rows[2]).toHaveTextContent('Бермет К.работает за клинику')
  expect(rows[2]).toHaveTextContent(/зарплата 22\s000 сом/)
  expect(rows[2]).toHaveTextContent(/14\s800 сом/)
  expect(rows[2]).toHaveTextContent(/6\s800 сом/)
  expect(rows[3]).toHaveTextContent(/Итого по врачам.*34\s800 сом/)
  // Зарплата / аренда в итоге: аренда Дастана + зарплата Бермет
  expect(within(rows[3]!).getAllByRole('cell')[2]).toHaveTextContent(/42\s000 сом/)

  const check = screen.getByLabelText('Сверка с прибылью')
  expect(check).toHaveTextContent(/Клинике от врачей34\s800 сом/)
  expect(check).toHaveTextContent(/Общие расходы клиники \(без врача\)−18\s000 сом/)
  expect(check).toHaveTextContent(/Склад: куплено больше, чем списано.*−800 сом/)
  expect(check).toHaveTextContent(/Врачам: начислено больше, чем выплачено.*21\s000 сом/)
  expect(within(check).getByLabelText('Прибыль клиники по врачам')).toHaveTextContent(/33\s000 сом/)
  expect(screen.getByRole('region', { name: 'Итог месяца по врачам' })).toHaveTextContent('общие расходы делим между врачами по их выручке')

  await user.click(within(screen.getByRole('region', { name: 'Итог месяца по врачам' })).getByRole('button', { name: 'CSV' }))
  const [name, csvRows] = vi.mocked(saveCsv).mock.calls[0]!
  expect(name).toMatch(/^итог-месяца-/)
  expect(csvRows.at(-1)).toEqual(['Прибыль клиники', '', '', '', '', '', '', 33000])
})

test('регистратура «Итог месяца по врачам» не видит', async () => {
  backend({ ...me, admin: false, reception: true, doctorId: undefined }, { month: '2026-11' })
  const user = userEvent.setup()
  renderApp()
  const tab = await findSub('Расходы').catch(() => null)
  if (tab) await user.click(tab)
  expect(screen.queryByRole('region', { name: 'Итог месяца по врачам' })).toBeNull()
})
