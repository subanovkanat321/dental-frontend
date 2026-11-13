import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

type Me = Schemas['BookingViewsMe']

/** Вымышленная независимая клиника: Дастан (id 2) — частный врач, Айгерим (id 1) — коллега. */
const dastan: Me = { ...me, admin: false, doctorId: 2, clinic: { ...me.clinic!, independentDoctors: true } }

const rent: Schemas['ExpensesExpense'] = {
  id: 5, spentOn: `${todayIn().slice(0, 7)}-01`, amountSom: 30000, category: 'Аренда', splitKey: 'CHAIRS', repeatMonthly: true,
  shares: [{ doctorId: 1, doctor: 'Айгерим Садыкова', amountSom: 22500 }, { doctorId: 2, doctor: 'Дастан Т.', amountSom: 7500 }],
}

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

function backend(posted: unknown[]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(dastan)),
    http.get('*/api/appointments/revenue', () => HttpResponse.json({
      totalSom: 25000, paidCount: 5, unpaidCount: 0, freeCount: 0, prepaidCount: 0, byMethod: { CASH: 25000 }, days: [],
      cash: { totalSom: 31000, paymentsCount: 6, depositsSom: 0, byMethod: { CASH: 31000 }, days: [], openingDebtsSom: 0 },
    } satisfies Schemas['RevenueView'])),
    http.get('*/api/expenses', () => HttpResponse.json([
      { id: 3, spentOn: todayIn(), amountSom: 2000, category: 'Зуботехническая лаборатория', doctorId: 2, repeatMonthly: false },
    ] satisfies Schemas['ExpensesExpense'][])),
    http.get('*/api/expenses/shared', () => HttpResponse.json([rent])),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: ['Аренда', 'Материалы'], own: [] } satisfies Schemas['ExpenseControllerCategories'])),
    http.post('*/api/expenses', async ({ request }) => {
      posted.push(await request.json())
      return HttpResponse.json({ ...rent, id: 9 }, { status: 201 })
    }),
  )
}

test('«Деньги»: приход, расход (свои + доля общих) и итог; «＋ Расход» — общий расход вручную с проверкой суммы', async () => {
  const posted: unknown[] = []
  backend(posted)
  const user = userEvent.setup()
  renderApp()

  const flow = await screen.findByLabelText('Приход и расход за период')
  expect(flow).toHaveTextContent(/Приход \(касса\)31\s000 сом/)
  expect(flow).toHaveTextContent(/Расход−9\s500 сом/)
  expect(flow).toHaveTextContent(/свои 2\s000 сом \+ доля общих 7\s500 сом/)
  expect(within(flow).getByLabelText('Итог за период')).toHaveTextContent(/21\s500 сом/)

  await user.click(screen.getByRole('button', { name: '＋ Расход' }))
  const dialog = await screen.findByRole('dialog', { name: 'Новый расход' })
  await user.click(within(dialog).getByRole('button', { name: 'Общий — делится между врачами' }))
  await user.type(within(dialog).getByRole('spinbutton', { name: 'Сумма, сом' }), '30000')
  await choose(within(dialog).getByRole('combobox', { name: 'Статья' }), 'Аренда')
  // По умолчанию — по креслам; выбираем «Вручную»
  expect(within(dialog).getByRole('combobox', { name: 'Как делить' })).toHaveTextContent('По креслам')
  await choose(within(dialog).getByRole('combobox', { name: 'Как делить' }), 'MANUAL')
  await user.type(within(dialog).getByLabelText('Доля: Айгерим Садыкова'), '20000')
  await user.type(within(dialog).getByLabelText('Доля: Дастан Т.'), '9000')
  expect(within(dialog).getByLabelText('Распределено')).toHaveTextContent(/осталось 1\s000 сом/)
  const save = within(dialog).getByRole('button', { name: 'Записать общий расход' })
  expect(save).toBeDisabled()
  await user.clear(within(dialog).getByLabelText('Доля: Дастан Т.'))
  await user.type(within(dialog).getByLabelText('Доля: Дастан Т.'), '10000')
  await user.click(within(dialog).getByRole('checkbox', { name: /Повторять каждый месяц/ }))
  await user.click(save)

  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({
    amountSom: 30000, category: 'Аренда', splitKey: 'MANUAL', repeatMonthly: true,
    shares: [{ doctorId: 1, amountSom: 20000 }, { doctorId: 2, amountSom: 10000 }],
  })
  expect(posted[0]).not.toHaveProperty('doctorId')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Новый расход' })).toBeNull())
})

test('«Материалы» в расходах — с подсказкой «не пишите, если поставка на склад»', async () => {
  backend([])
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Расход' }))
  const dialog = await screen.findByRole('dialog', { name: 'Новый расход' })
  await choose(within(dialog).getByRole('combobox', { name: 'Статья' }), 'Материалы')
  expect(within(dialog).getByRole('note')).toHaveTextContent('сюда не пишите, иначе посчитается дважды')
})

test('«Расходы»: общие расходы клиники с долями всех врачей, своя доля выделена', async () => {
  backend([])
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  const block = await screen.findByRole('region', { name: 'Общие расходы клиники' })
  expect(within(block).getByLabelText('Доли: Аренда')).toHaveTextContent(/Айгерим Садыкова: 22\s500 сом.*Дастан Т\.: 7\s500 сом/)
  expect(block).toHaveTextContent(/Ваша доля за месяц: 7\s500 сом/)
  expect(within(block).getByRole('button', { name: /каждый месяц/ })).toBeInTheDocument()
  expect(block).toHaveTextContent('по креслам')
})

test('«Чистыми за месяц» независимого врача: потери, мои расходы по статьям, доля общих расходов', async () => {
  backend([])
  server.use(
    http.get('*/api/me/earnings', () => HttpResponse.json({
      date: todayIn(), month: todayIn().slice(0, 7), hasTerms: false, percent: 0, baseSom: 0, todaySom: 0, todayRevenueSom: 0, monthSom: 0,
      monthRevenueSom: 50000, previousMonthSom: 0, workDaysLeft: 9, eveningSummary: true, rentSom: 0,
    } satisfies Schemas['EarningsView'])),
    http.get('*/api/me/net-month', () => HttpResponse.json({
      month: '2026-11', purchasedSom: 1800, expenses: [{ category: 'Зарплата', amountSom: 15000 }, { category: 'Зуботехническая лаборатория', amountSom: 2000 }],
      row: {
        doctorId: 2, doctor: 'Дастан Т.', selfEmployed: true, revenueSom: 50000, earnedSom: 50000, rentSom: 0, materialsSom: 900, unpricedMaterials: 0,
        lossesSom: 200, expensesSom: 17000, sharedExpensesSom: 7500, doctorNetSom: 24400, clinicSom: 0, rentTwice: false,
      },
    } satisfies Schemas['NetMonthMine'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Мой заработок'))
  const block = await screen.findByRole('region', { name: 'Чистыми за месяц' })
  expect(block).toHaveTextContent(/Материалы по списанию ≈−900 сом/)
  expect(block).toHaveTextContent(/Потери и пересчёт ≈−200 сом/)
  expect(block).toHaveTextContent(/Мои расходы−17\s000 сомЗарплата−15\s000 сом/)
  expect(block).toHaveTextContent(/Доля общих расходов−7\s500 сом/)
  expect(within(block).getByLabelText('Чистыми')).toHaveTextContent(/24\s400 сом/)
  expect(block).toHaveTextContent(/Закуплено на ваш склад за месяц: 1\s800 сом — справочно/)
})
