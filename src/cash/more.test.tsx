import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn, weekLabel } from '../lib/time'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { pickDate } from '../test/date'
import { choose } from '../test/select'

beforeEach(() => {
  window.location.hash = '/cash'
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('подпись недели: в одном месяце и на стыке месяцев', () => {
  expect(weekLabel('2026-06-01')).toBe('1–7 июн')
  expect(weekLabel('2026-06-29')).toBe('29 июн – 5 июл')
})

test('расходы: список по статьям, прибыль, добавить свою статью и удалить', async () => {
  const month = todayIn().slice(0, 7)
  let expenses: Schemas['ExpensesExpense'][] = [
    { id: 1, spentOn: `${month}-01`, amountSom: 30000, category: 'Аренда', repeatMonthly: false },
    { id: 2, spentOn: `${month}-02`, amountSom: 5000, category: 'Техник', comment: 'коронка', repeatMonthly: false },
  ]
  const posted: unknown[] = []
  server.use(
    http.get('*/api/expenses', () => HttpResponse.json(expenses)),
    http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Бакыт М.', phone: '996555000111' }])),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: ['Аренда', 'Техник'], own: [] } satisfies Schemas['ExpenseControllerCategories'])),
    http.get('*/api/supplies/spending', () => HttpResponse.json({ revenueSom: 100000, purchasedSom: 10000, expensesSom: 35000, usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0, lossesSom: 0 } satisfies Schemas['SpendingView'])),
    http.post('*/api/expenses', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      posted.push(body)
      expenses = [...expenses, { id: 3, spentOn: body.spentOn as string, amountSom: body.amountSom as number, category: body.category as string, repeatMonthly: false }]
      return HttpResponse.json(expenses[2])
    }),
    http.delete('*/api/expenses/:id', ({ params }) => {
      expenses = expenses.filter((x) => String(x.id) !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()

  await user.click(await findSub('Расходы'))
  await waitFor(() => expect(screen.getByLabelText('Расходы за месяц')).toHaveTextContent('35 000'))
  // Структура расходов — бублик: доли в описании, легенда с суммой и процентом, в центре — итог месяца
  expect(screen.getByRole('img', { name: /^Расходы по статьям:/ }).getAttribute('aria-label')?.replace(/\s/g, ' '))
    .toBe('Расходы по статьям: Аренда 30 000 сом (86%), Техник 5 000 сом (14%)')
  expect(screen.getByText('итог месяца').previousSibling).toHaveTextContent(/35\s000 сом/)
  const chart = screen.getByRole('list', { name: 'Расходы по статьям' })
  const bars = within(chart).getAllByRole('button')
  expect(bars.map((b) => b.textContent?.replace(/\s/g, ' '))).toEqual(['Аренда30 000 сом86%', 'Техник5 000 сом14%'])
  // Нажатие на статью — фильтр списка; ещё раз — все статьи
  await user.click(bars[1]!)
  expect(bars[1]).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('cell', { name: 'Аренда' })).not.toBeInTheDocument()
  expect(screen.getByRole('cell', { name: 'Техник' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Статья расходов' })).toHaveTextContent('Техник')
  await user.click(bars[1]!)
  expect(screen.getByRole('cell', { name: 'Аренда' })).toBeInTheDocument()
  const profit = await screen.findByLabelText('Прибыль за месяц')
  // Прибыль — материалы по списанию (0), закупки 10 000 — справочно: 100 000 − 35 000
  expect(within(profit).getByText('Прибыль').parentElement).toHaveTextContent('65 000')
  expect(screen.getByLabelText('Закуплено на склад')).toHaveTextContent(/Закуплено на склад за месяц: 10\s000 сом — справочно/)

  const form = screen.getByRole('form', { name: 'Новый расход' })
  await user.type(within(form).getByRole('spinbutton', { name: 'Сумма, сом' }), '2000')
  await choose(within(form).getByRole('combobox', { name: 'Статья' }), '*')
  await user.type(within(form).getByRole('textbox', { name: 'Своя статья' }), 'Реклама')
  // Расход по пациенту — необязательно: найти и выбрать
  await user.type(within(form).getByRole('searchbox', { name: 'Пациент — необязательно' }), 'Бак')
  await user.click(await within(form).findByRole('button', { name: 'Бакыт М.' }))
  expect(within(form).getByText(/Пациент: Бакыт М\./)).toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByRole('cell', { name: 'Реклама' })).toBeInTheDocument()
  expect(posted[0]).toMatchObject({ amountSom: 2000, category: 'Реклама', spentOn: todayIn(), patientId: 7 })

  await user.click(screen.getByRole('button', { name: 'Удалить расход: Аренда 30000' }))
  expect(await screen.findByLabelText('Расходы за месяц')).toHaveTextContent('7 000')
})

test('прибыль: аренда кресла, полученная от врача, — доход клиники', async () => {
  server.use(
    http.get('*/api/expenses', () => HttpResponse.json([])),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: [], own: [] } satisfies Schemas['ExpenseControllerCategories'])),
    // Врач забрал всю выручку (5 000), аренда 20 000 больше — он принёс клинике 15 000
    http.get('*/api/supplies/spending', () => HttpResponse.json({ revenueSom: 5000, purchasedSom: 0, expensesSom: 0, rentSom: 15000, usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0, lossesSom: 0 } satisfies Schemas['SpendingView'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  const profit = await screen.findByLabelText('Прибыль за месяц')
  expect(within(profit).getByText('Аренда от врачей').parentElement).toHaveTextContent('15 000')
  expect(within(profit).getByText('Прибыль').parentElement).toHaveTextContent('20 000')
})

test('расходы: пустой месяц — без диаграммы', async () => {
  server.use(
    http.get('*/api/expenses', () => HttpResponse.json([])),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: ['Аренда'], own: [] } satisfies Schemas['ExpenseControllerCategories'])),
    http.get('*/api/supplies/spending', () => HttpResponse.json({ revenueSom: 0, purchasedSom: 0, expensesSom: 0, usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0, lossesSom: 0 } satisfies Schemas['SpendingView'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  expect(await screen.findByText(/^Расходов за .+ нет$/)).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Расходы по статьям' })).not.toBeInTheDocument()
})

test('статистика: неявки по неделям, среднее без текущей недели, оценки', async () => {
  server.use(
    http.get('*/api/appointments/stats', () => HttpResponse.json([
      { weekStart: '2026-10-26', booked: 10, done: 3, noShow: 0, cancelled: 0, reminded: 5, unmarked: 0 },
      { weekStart: '2026-10-19', booked: 20, done: 17, noShow: 2, cancelled: 1, reminded: 15, unmarked: 0 },
      { weekStart: '2026-10-12', booked: 18, done: 14, noShow: 1, cancelled: 2, reminded: 12, unmarked: 1 },
    ] satisfies Schemas['WeekStats'][])),
    http.get('*/api/appointments/ratings', () => HttpResponse.json({ average: 4.5, count: 4, byStars: [0, 0, 0, 2, 2] } satisfies Schemas['RatingSummary'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Статистика'))
  expect(await screen.findByLabelText('Неявок в неделю')).toHaveTextContent('1,5')
  expect(screen.getByText(/Не отмечено «явка \/ неявка»: 1/)).toBeInTheDocument()
  expect(within(screen.getByRole('table', { name: 'Неявки по неделям' })).getAllByRole('row')).toHaveLength(4)
  expect(await screen.findByLabelText('Средняя оценка')).toHaveTextContent('4,5')
})

test('отчёт: строки месяца, итоги и отправка в бот', async () => {
  let sent: unknown = null
  server.use(
    http.get('*/api/appointments/report', () => HttpResponse.json([
      { id: 1, startAt: `${todayIn()}T04:00:00Z`, patient: 'Бакыт М.', doctor: 'Айгерим Садыкова', status: 'DONE', paidSom: 3000, debtSom: 1000 },
      { id: 2, startAt: `${todayIn()}T05:00:00Z`, patient: 'Нурлан К.', doctor: 'Айгерим Садыкова', status: 'NO_SHOW' },
    ] satisfies Schemas['AppointmentServiceReportRow'][])),
    http.post('*/api/appointments/report', async ({ request }) => {
      sent = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Отчёт'))
  expect(await screen.findByRole('cell', { name: 'Бакыт М.' })).toBeInTheDocument()
  expect(screen.getByText(/Оплачено:/)).toHaveTextContent('3 000 сом · долги: 1 000 сом · приёмов: 2 · состоялось: 1 · неявок: 1')
  expect(screen.getByRole('cell', { name: 'Состоялся' })).toBeInTheDocument()
  await choose(screen.getByLabelText('Статус'), 'Неявка')
  expect(screen.queryByRole('cell', { name: 'Бакыт М.' })).not.toBeInTheDocument()
  await choose(screen.getByLabelText('Статус'), '')
  await user.click(screen.getByRole('button', { name: 'Отправить в бот' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Отчёт отправлен в Telegram')
  expect(sent).toEqual({ month: todayIn().slice(0, 7) })
})

test('отчёт: дни внутри месяца — «с … по …» и быстрые кнопки', async () => {
  const m = todayIn().slice(0, 7)
  server.use(
    http.get('*/api/appointments/report', () => HttpResponse.json([
      { id: 1, startAt: `${m}-03T04:00:00Z`, patient: 'Бакыт М.', doctor: 'Айгерим Садыкова', status: 'DONE', paidSom: 3000 },
      { id: 2, startAt: `${m}-05T04:00:00Z`, patient: 'Нурлан К.', doctor: 'Айгерим Садыкова', status: 'DONE', paidSom: 2000 },
    ] satisfies Schemas['AppointmentServiceReportRow'][])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Отчёт'))
  expect(await screen.findByRole('cell', { name: 'Нурлан К.' })).toBeInTheDocument()
  await pickDate(screen.getByLabelText('По день'), `${m}-03`)
  expect(screen.queryByRole('cell', { name: 'Нурлан К.' })).not.toBeInTheDocument()
  expect(screen.getByText(/Оплачено:/)).toHaveTextContent('3 000 сом')
  await user.click(screen.getByRole('button', { name: 'Весь месяц' }))
  expect(screen.getByRole('cell', { name: 'Нурлан К.' })).toBeInTheDocument()
})
