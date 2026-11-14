import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp, findSub, querySub } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Finance = Schemas['PlatformFinanceFinance']

beforeEach(() => {
  window.location.hash = '/platform'
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

const owner = { ...me, owner: true, platform: true }

/** '2026-11' − 1 → '2026-10'. */
function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const i = y! * 12 + m! - 1 + by
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

const current = todayIn().slice(0, 7)

function history(month: string): Schemas['PlatformFinanceMonthTotal'][] {
  return Array.from({ length: 12 }, (_, k) => {
    const m = shift(month, k - 11)
    return k === 11 ? { month: m, incomeSom: 10470, expenseSom: 3055, profitSom: 7415, pendingSom: 0 }
      : k === 10 ? { month: m, incomeSom: 0, expenseSom: 1200, profitSom: -1200, pendingSom: 0 }
        : { month: m, incomeSom: 0, expenseSom: 0, profitSom: 0, pendingSom: 0 }
  })
}

function finance(month: string): Finance {
  return {
    month, incomeSom: 10470, expenseSom: 3055, profitSom: 7415,
    expenses: [
      { key: 'AI', label: 'ИИ в приложении', som: 97, auto: true, count: 42, needsPrice: false },
      { key: 'SMS', label: 'SMS', som: 0, auto: true, count: 3, needsPrice: true },
      { key: 'Claude (разработка)', label: 'Claude (разработка)', som: 1750, auto: false, count: 1, needsPrice: false },
      { key: 'Сервер и домен', label: 'Сервер и домен', som: 1200, auto: false, count: 1, needsPrice: false },
    ],
    income: [{ clinicId: 2, name: 'Стоматология «Альфа»', som: 7470, payments: 1 }, { clinicId: 1, name: 'Кабинет «Бета»', som: 3000, payments: 1 }],
    entries: [
      { id: 5, category: 'Claude (разработка)', amountSom: 1750, amountUsd: 20, usdRate: 87.5, spentOn: `${month}-02`, monthly: false },
      { id: 6, category: 'Сервер и домен', amountSom: 1200, spentOn: '2026-01-15', monthly: true },
    ],
    history: history(month),
    settings: { lastUsdRate: 87.5 },
    categories: ['Claude (разработка)', 'Реклама', 'Сервер и домен', 'SMS-провайдер (пополнение)', 'Прочее'], pendingSom: 0, topupSom: 0
  }
}

const emptyMonth = (month: string): Finance => ({
  month, incomeSom: 0, expenseSom: 0, profitSom: 0,
  expenses: [{ key: 'AI', label: 'ИИ в приложении', som: 0, auto: true, count: 0, needsPrice: false },
    { key: 'SMS', label: 'SMS', som: 0, auto: true, count: 0, needsPrice: true }],
  income: [], entries: [], history: history(month).map((m) => ({ ...m, incomeSom: 0, expenseSom: 0, profitSom: 0, pendingSom: 0 })),
  settings: { lastUsdRate: 87 }, categories: [], pendingSom: 0, topupSom: 0
})

test('владелец: «Финансы» — итог, авто-расходы, доходы по клиникам, переключение месяца', async () => {
  const months: (string | null)[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', ({ request }) => {
      const month = new URL(request.url).searchParams.get('month')
      months.push(month)
      return HttpResponse.json(month === current ? finance(current) : emptyMonth(month ?? current))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  expect(await screen.findByLabelText('Доход за месяц')).toHaveTextContent('10 470 сом')
  expect(screen.getByLabelText('Расход за месяц')).toHaveTextContent('3 055 сом')
  expect(screen.getByLabelText('Прибыль за месяц')).toHaveTextContent('7 415 сом')
  expect(screen.getByLabelText('Прибыль за месяц')).toHaveClass('tone-ok')

  const lines = screen.getByLabelText('Расходы по статьям')
  expect(within(lines).getByText('ИИ в приложении').closest('div')).toHaveTextContent('считается само · 42 запросов к ИИ')
  expect(within(lines).getByText('SMS').closest('div')).toHaveTextContent('3 SMS · укажите цену SMS ниже')
  expect(within(lines).getByText('Claude (разработка)').closest('div')).toHaveTextContent('1 750 сом')

  const income = screen.getByRole('table', { name: 'Оплаты клиник за месяц' })
  expect(within(income).getByRole('row', { name: /Альфа/ })).toHaveTextContent('7 470 сом')
  expect(screen.getByRole('list', { name: 'Ручные расходы месяца' })).toHaveTextContent('$20 × 87,5')

  // График: 12 месяцев, нажатие — открыть месяц
  const chart = screen.getByRole('region', { name: 'За 12 месяцев' })
  expect(within(chart).getByRole('img').getAttribute('aria-label')).toMatch(/прибыль −1\s200\sсом/)

  await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
  expect(await screen.findByText('В этом месяце оплат от клиник не было')).toBeInTheDocument()
  expect(screen.getByText('В этом месяце ручных расходов нет')).toBeInTheDocument()
  expect(screen.getByText(/За год ни доходов, ни расходов/)).toBeInTheDocument()
  expect(months).toEqual([current, shift(current, -1)])
})

test('добавить расход в долларах, исправить (отменить подписку) и удалить', async () => {
  const calls: [string, unknown][] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json(finance(current))),
    http.post('*/api/platform/finance/expenses', async ({ request }) => {
      const body = await request.json()
      calls.push(['POST', body])
      const created: Schemas['PlatformExpensesExpense'] = { id: 9, category: 'Реклама', amountSom: 870, amountUsd: 10, usdRate: 87,
        spentOn: todayIn(), monthly: false }
      return HttpResponse.json(created, { status: 201 })
    }),
    http.put('*/api/platform/finance/expenses/:id', async ({ params, request }) => {
      calls.push([`PUT ${String(params.id)}`, await request.json()])
      const updated: Schemas['PlatformExpensesExpense'] = { id: 6, amountSom: 0, monthly: false }
      return HttpResponse.json(updated)
    }),
    http.delete('*/api/platform/finance/expenses/:id', ({ params }) => {
      calls.push([`DELETE ${String(params.id)}`, null])
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('*/api/platform/finance/settings', async ({ request }) => {
      calls.push(['SETTINGS', await request.json()])
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  await user.click(await screen.findByRole('button', { name: 'Добавить расход' }))
  const form = screen.getByRole('form', { name: 'Новый расход' })
  await user.click(within(form).getByRole('button', { name: 'Реклама' }))
  await user.click(within(form).getByRole('button', { name: 'В долларах' }))
  // Курс по умолчанию — последний введённый
  expect(within(form).getByLabelText('Курс: сомов за $1')).toHaveValue(87.5)
  await user.clear(within(form).getByLabelText('Курс: сомов за $1'))
  await user.type(within(form).getByLabelText('Курс: сомов за $1'), '87')
  await user.type(within(form).getByLabelText('Сумма, $'), '10')
  expect(within(form).getByText(/≈ 870 сом/)).toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await screen.findByRole('button', { name: 'Добавить расход' })
  expect(calls[0]).toEqual(['POST', { category: 'Реклама', amountUsd: 10, usdRate: 87, spentOn: todayIn(), monthly: false }])

  // Исправить подписку: отменить с сегодня
  await user.click(screen.getByRole('button', { name: 'Исправить: Сервер и домен' }))
  const edit = screen.getByRole('form', { name: 'Исправить расход' })
  expect(within(edit).getByLabelText(/Каждый месяц/)).toBeChecked()
  await user.click(within(edit).getByRole('button', { name: 'Отменить с сегодня' }))
  await user.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  await screen.findByRole('button', { name: 'Исправить: Сервер и домен' })
  expect(calls[1]).toEqual(['PUT 6', { category: 'Сервер и домен', amountSom: 1200, spentOn: '2026-01-15', monthly: true, endedOn: todayIn() }])

  // Удалить — с подтверждением
  await user.click(screen.getByRole('button', { name: 'Исправить: Claude (разработка)' }))
  await user.click(within(screen.getByRole('form', { name: 'Исправить расход' })).getByRole('button', { name: 'Удалить' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
  await screen.findByRole('button', { name: 'Исправить: Claude (разработка)' })
  expect(calls[2]).toEqual(['DELETE 5', null])

  // Цена SMS
  await user.type(screen.getByLabelText(/Цена одной SMS/), '1.5')
  await user.click(within(screen.getByRole('form', { name: 'Цена SMS' })).getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Сохранено.')).toBeInTheDocument()
  expect(calls[3]).toEqual(['SETTINGS', { smsPriceSom: 1.5 }])
})

test('ошибка сервера под полем: курс', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json(finance(current))),
    http.post('*/api/platform/finance/expenses', () => HttpResponse.json({
      status: 422, detail: 'Проверьте поля', errors: [{ field: 'usdRate', message: 'Курс — больше нуля, до двух знаков' }],
    }, { status: 422 })),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  await user.click(await screen.findByRole('button', { name: 'Добавить расход' }))
  const form = screen.getByRole('form', { name: 'Новый расход' })
  await user.type(within(form).getByLabelText('Статья'), 'Реклама')
  await user.click(within(form).getByRole('button', { name: 'В долларах' }))
  await user.type(within(form).getByLabelText('Сумма, $'), '10')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await within(form).findByText('Курс — больше нуля, до двух знаков')).toBeInTheDocument()
})

test('период: квартал, год, всё время и свой — итоги, таблица по месяцам и запросы к серверу', async () => {
  const queries: string[] = []
  const months: Schemas['PlatformFinanceMonthTotal'][] = [
    { month: '2026-01', incomeSom: 0, expenseSom: 1200, profitSom: -1200, pendingSom: 0 },
    { month: '2026-02', incomeSom: 2000, expenseSom: 1249, profitSom: 751, pendingSom: 0 },
    { month: '2026-03', incomeSom: 10470, expenseSom: 3047, profitSom: 7423, pendingSom: 0 },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', ({ request }) => {
      const q = new URL(request.url).searchParams
      queries.push(q.toString())
      const period = q.get('period')
      if (!period) return HttpResponse.json(finance(current))
      const body: Finance = { ...finance(current), period, from: '2026-01', to: '2026-03', month: q.get('month') ?? '2026-03',
        incomeSom: 12470, expenseSom: 5496, profitSom: 6974, months }
      return HttpResponse.json(body)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  await screen.findByLabelText('Доход за месяц')
  // В режиме «Месяц» таблицы по месяцам нет, есть 12 месяцев
  expect(screen.queryByRole('table', { name: 'Итоги по месяцам' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'За 12 месяцев' })).toBeInTheDocument()

  const periods = screen.getByRole('group', { name: 'Период' })
  await user.click(within(periods).getByRole('button', { name: 'Квартал' }))
  expect(await screen.findByLabelText('Доход за период')).toHaveTextContent('12 470 сом')
  expect(screen.getByLabelText('Расход за период')).toHaveTextContent('5 496 сом')
  expect(screen.getByLabelText('Прибыль за период')).toHaveTextContent('6 974 сом')
  expect(screen.getByText(/^январь — март 2026/)).toBeInTheDocument()
  expect(within(periods).getByRole('button', { name: 'Квартал' })).toHaveAttribute('aria-pressed', 'true')
  const table = screen.getByRole('table', { name: 'Итоги по месяцам' })
  expect(within(table).getByRole('row', { name: /январь 2026/ })).toHaveTextContent('−1 200 сом')
  expect(within(table).getByRole('row', { name: /Итого/ })).toHaveTextContent('12 470 сом')
  expect(screen.queryByRole('region', { name: 'За 12 месяцев' })).not.toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Оплаты клиник за период' })).toBeInTheDocument()

  // Предыдущий квартал — на 3 месяца назад от начала текущего
  await user.click(screen.getByRole('button', { name: 'Предыдущий: квартал' }))
  await user.click(within(periods).getByRole('button', { name: 'Год' }))
  await user.click(within(periods).getByRole('button', { name: 'Всё время' }))
  await user.click(within(periods).getByRole('button', { name: 'Свой период' }))
  expect(await screen.findByRole('group', { name: 'Первый месяц' })).toBeInTheDocument()

  // Нажатие на месяц в таблице — открыть этот месяц
  await user.click(within(screen.getByRole('table', { name: 'Итоги по месяцам' })).getByRole('button', { name: 'март 2026' }))
  expect(await screen.findByLabelText('Доход за месяц')).toBeInTheDocument()
  expect(within(periods).getByRole('button', { name: 'Месяц' })).toHaveAttribute('aria-pressed', 'true')

  const qs = (() => {
    const [y, m] = current.split('-').map(Number)
    const start = `${y}-${String(Math.floor((m! - 1) / 3) * 3 + 1).padStart(2, '0')}`
    return { quarter: current, prev: shift(start, -3), from: shift(current, -2) }
  })()
  expect(queries).toEqual([
    `month=${current}`,
    `period=quarter&month=${qs.quarter}`,
    `period=quarter&month=${qs.prev}`,
    `period=year&month=${qs.prev}`,
    'period=all',
    `period=custom&from=${qs.from}&to=${current}`,
    'month=2026-03',
  ])
})

test('не владельцу вкладки «Финансы» нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: false, platform: true })))
  renderApp()
  expect(await findSub('Клиники')).toBeInTheDocument()
  expect(querySub('Финансы')).not.toBeInTheDocument()
})

test('«каждый месяц» по факту: блок «Ожидаются», «Оплачено» с подтверждением, «Не в этом месяце», итоги факт + «ещё ожидается»', async () => {
  const prev = shift(current, -1)
  const prevName = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long' }).format(new Date(`${prev}-01T00:00:00Z`))
  const calls: [string, unknown][] = []
  const data: Finance = {
    ...finance(current),
    expenseSom: 1305, profitSom: 9165, pendingSom: 2950,
    expenses: finance(current).expenses!.slice(0, 2),
    entries: [
      { id: 5, category: 'Claude (разработка)', amountSom: 1750, amountUsd: 20, usdRate: 87.5, spentOn: '2026-10-03', monthly: true },
      { id: 6, category: 'Сервер и домен', amountSom: 1200, spentOn: '2026-09-15', monthly: true },
    ],
    due: [
      { expenseId: 6, category: 'Сервер и домен', month: prev, amountSom: 1200, day: 15, overdue: true },
      { expenseId: 5, category: 'Claude (разработка)', month: current, amountSom: 1750, amountUsd: 20, usdRate: 87.5, day: 3, overdue: false },
    ],
    marks: [{ expenseId: 6, category: 'Сервер и домен', month: current, status: 'PAID', amountSom: 1208, paidOn: `${current}-01` }],
    factFrom: '2026-11',
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json(data)),
    http.put('*/api/platform/finance/expenses/:id/months/:month', async ({ params, request }) => {
      calls.push([`PUT ${String(params.id)} ${String(params.month)}`, await request.json()])
      const mark: Schemas['PlatformExpensesMark'] = { expenseId: Number(params.id), month: String(params.month), status: 'PAID' }
      return HttpResponse.json(mark)
    }),
    http.delete('*/api/platform/finance/expenses/:id/months/:month', ({ params }) => {
      calls.push([`DELETE ${String(params.id)} ${String(params.month)}`, null])
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))

  // Итоги — только факт; рядом мелко «ещё ожидается» и прогноз прибыли
  expect(await screen.findByLabelText('Расход за месяц')).toHaveTextContent('1 305 сом')
  const totals = screen.getByRole('region', { name: 'Итог периода' })
  expect(totals).toHaveTextContent('ещё ожидается: 2 950 сом')
  expect(totals).toHaveTextContent('если оплатить всё ожидаемое: 6 215 сом')

  const block = screen.getByRole('region', { name: 'Ожидаются в этом месяце' })
  const items = within(block).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent(`Сервер и домен — 1 200 сом`)
  expect(items[0]).toHaveTextContent(`не отмечено за ${prevName}`)
  expect(items[1]).toHaveTextContent('Claude (разработка) — $20 × 87,5 ≈ 1 750 сом')
  expect(items[1]).toHaveTextContent('обычно до 3-го числа')
  expect(items[1]).not.toHaveTextContent('не отмечено')

  // «Оплачено» — форма с суммой шаблона в долларах и сегодняшним днём; поправили сумму
  await user.click(within(block).getByRole('button', { name: /^Оплачено: Claude/ }))
  const pay = within(block).getByRole('form', { name: 'Оплата: Claude (разработка)' })
  expect(within(pay).getByLabelText('Оплачено, $')).toHaveValue(20)
  expect(within(pay).getByLabelText('Курс: сомов за $1')).toHaveValue(87.5)
  await user.clear(within(pay).getByLabelText('Оплачено, $'))
  await user.type(within(pay).getByLabelText('Оплачено, $'), '21')
  expect(within(pay).getByText(/≈ 1 838 сом/)).toBeInTheDocument()
  await user.click(within(pay).getByRole('button', { name: 'Сохранить оплату' }))
  await within(block).findByRole('button', { name: /^Оплачено: Claude/ })
  expect(calls[0]).toEqual([`PUT 5 ${current}`, { status: 'PAID', paidOn: todayIn(), amountUsd: 21, usdRate: 87.5 }])

  // «Не в этом месяце» — пропущено за прошлый месяц
  await user.click(within(block).getByRole('button', { name: /^Не в этом месяце: Сервер и домен/ }))
  await waitForSlow(() => expect(calls).toHaveLength(2))
  expect(calls[1]).toEqual([`PUT 6 ${prev}`, { status: 'SKIPPED' }])

  // Отметка в записях — «снять»: месяц снова ожидается
  const marks = screen.getByRole('list', { name: 'Отметки: Сервер и домен' })
  expect(marks).toHaveTextContent('оплачено 1 208 сом')
  await user.click(within(marks).getByRole('button', { name: /^Снять отметку: Сервер и домен/ }))
  await waitForSlow(() => expect(calls).toHaveLength(3))
  expect(calls[2]).toEqual([`DELETE 6 ${current}`, null])
})

test('нет ожидаемых — блока нет и «ещё ожидается» не показываем', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json({ ...finance(current), due: [], pendingSom: 0 })),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  expect(await screen.findByLabelText('Расход за месяц')).toHaveTextContent('3 055 сом')
  expect(screen.queryByRole('region', { name: 'Ожидаются в этом месяце' })).not.toBeInTheDocument()
  expect(screen.queryByText(/ещё ожидается/)).not.toBeInTheDocument()
})

/** Балансы: ИИ — с запасом, SMS — остаток 30 из последних 500 (меньше 10%) — «пора пополнить». */
function withTopups(month: string): Finance {
  return {
    ...finance(month),
    topupSom: 4875,
    balances: [
      { service: 'AI', label: 'ИИ', topupTotalSom: 8750, topupPeriodSom: 4375, since: '2026-03-01', spentSinceSom: 1585,
        spentPeriodSom: 97, balanceSom: 7165, lastTopupSom: 4375, low: false, needsPrice: false },
      { service: 'SMS', label: 'SMS', topupTotalSom: 500, topupPeriodSom: 500, since: '2026-03-10', spentSinceSom: 470,
        spentPeriodSom: 60, balanceSom: 30, lastTopupSom: 500, low: true, needsPrice: false },
    ],
    topups: [
      { id: 3, service: 'SMS', amountSom: 500, paidOn: `${month}-03`, comment: 'SMSPRO', createdBy: 1 },
      { id: 2, service: 'AI', amountSom: 4375, amountUsd: 50, usdRate: 87.5, paidOn: `${month}-01`, comment: 'Anthropic $50', createdBy: 1 },
      { id: 1, service: 'AI', amountSom: 4375, amountUsd: 50, usdRate: 87.5, paidOn: '2026-03-01', comment: 'Anthropic $50', createdBy: 1 },
    ],
  }
}

test('балансы ИИ и SMS: пополнено, израсходовано, остаток и «пора пополнить»; пополнения не в расходе', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json(withTopups(current))),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  const block = await screen.findByRole('region', { name: 'Балансы ИИ и SMS' })
  const ai = within(block).getByRole('group', { name: 'Баланс ИИ' })
  expect(ai).toHaveTextContent('Пополнено')
  expect(ai).toHaveTextContent('8 750 сом')
  expect(ai).toHaveTextContent('за месяц: 4 375 сом')
  expect(ai).toHaveTextContent('1 585 сом')
  expect(within(ai).getByLabelText('Остаток ИИ')).toHaveTextContent('7 165 сом')
  expect(within(ai).queryByText('пора пополнить')).not.toBeInTheDocument()

  const sms = within(block).getByRole('group', { name: 'Баланс SMS' })
  expect(within(sms).getByText('пора пополнить')).toBeInTheDocument()
  expect(within(sms).getByLabelText('Остаток SMS')).toHaveTextContent('30 сом')
  expect(within(sms).getByLabelText('Остаток SMS')).toHaveClass('tone-wait')

  expect(within(block).getByRole('list', { name: 'Пополнения' })).toHaveTextContent('Anthropic $50')
  expect(within(block).getByRole('list', { name: 'Пополнения' })).toHaveTextContent('$50 × 87,5')

  // Итог месяца: расход — как был, пополнения — отдельной строкой
  expect(screen.getByLabelText('Расход за месяц')).toHaveTextContent('3 055 сом')
  expect(screen.getByText(/^пополнения:/)).toHaveTextContent('пополнения: 4 875 сом — не в расходе')
})

test('баланс в минусе — красный остаток; без пополнений — подсказка', async () => {
  const f = withTopups(current)
  f.balances = [
    { service: 'AI', label: 'ИИ', topupTotalSom: 0, topupPeriodSom: 0, spentSinceSom: 0, spentPeriodSom: 97, balanceSom: 0, low: false, lastTopupSom: 0, needsPrice: false },
    { service: 'SMS', label: 'SMS', topupTotalSom: 500, topupPeriodSom: 0, since: '2026-03-10', spentSinceSom: 520, spentPeriodSom: 60,
      balanceSom: -20, lastTopupSom: 500, low: true, needsPrice: false },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json(f)),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  const block = await screen.findByRole('region', { name: 'Балансы ИИ и SMS' })
  expect(within(block).getByRole('group', { name: 'Баланс ИИ' })).toHaveTextContent('Пополнений ещё не было')
  const sms = within(block).getByRole('group', { name: 'Баланс SMS' })
  expect(within(sms).getByLabelText('Остаток SMS')).toHaveTextContent('−20 сом')
  expect(within(sms).getByLabelText('Остаток SMS')).toHaveClass('tone-bad')
  expect(within(sms).getByText('пора пополнить')).toBeInTheDocument()
})

test('пополнение: добавить в долларах, исправить и удалить', async () => {
  const calls: [string, unknown][] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/finance', () => HttpResponse.json(withTopups(current))),
    http.post('*/api/platform/finance/topups', async ({ request }) => {
      calls.push(['POST', await request.json()])
      const created: Schemas['PlatformTopupsTopup'] = { id: 9, service: 'AI', amountSom: 4375, createdBy: 0 }
      return HttpResponse.json(created, { status: 201 })
    }),
    http.put('*/api/platform/finance/topups/:id', async ({ params, request }) => {
      calls.push([`PUT ${String(params.id)}`, await request.json()])
      const updated: Schemas['PlatformTopupsTopup'] = { id: 3, amountSom: 0, createdBy: 0 }
      return HttpResponse.json(updated)
    }),
    http.delete('*/api/platform/finance/topups/:id', ({ params }) => {
      calls.push([`DELETE ${String(params.id)}`, null])
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Финансы'))
  await user.click(await screen.findByRole('button', { name: '＋ Пополнение' }))
  const form = screen.getByRole('form', { name: 'Новое пополнение' })
  // По умолчанию — ИИ в долларах по последнему курсу
  expect(within(form).getByRole('button', { name: 'ИИ' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(form).getByLabelText('Курс: сомов за $1')).toHaveValue(87.5)
  await user.type(within(form).getByLabelText('Сумма, $'), '50')
  expect(within(form).getByText(/≈ 4 375 сом/)).toBeInTheDocument()
  await user.type(within(form).getByLabelText(/Комментарий/), 'Anthropic $50')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await screen.findByRole('button', { name: '＋ Пополнение' })
  expect(calls[0]).toEqual(['POST', { service: 'AI', amountUsd: 50, usdRate: 87.5, paidOn: todayIn(), comment: 'Anthropic $50' }])

  // Исправить: SMS 500 сом → 700
  await user.click(screen.getByRole('button', { name: /^Исправить пополнение: SMS/ }))
  const edit = screen.getByRole('form', { name: 'Исправить пополнение' })
  expect(within(edit).getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true')
  await user.clear(within(edit).getByLabelText('Сумма, сом'))
  await user.type(within(edit).getByLabelText('Сумма, сом'), '700')
  await user.click(within(edit).getByRole('button', { name: 'Сохранить' }))
  await screen.findByRole('button', { name: /^Исправить пополнение: SMS/ })
  expect(calls[1]).toEqual(['PUT 3', { service: 'SMS', amountSom: 700, paidOn: `${current}-03`, comment: 'SMSPRO' }])

  // Удалить — с подтверждением
  await user.click(screen.getByRole('button', { name: /^Исправить пополнение: SMS/ }))
  await user.click(within(screen.getByRole('form', { name: 'Исправить пополнение' })).getByRole('button', { name: 'Удалить' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Удалить' }))
  await screen.findByRole('button', { name: /^Исправить пополнение: SMS/ })
  expect(calls[2]).toEqual(['DELETE 3', null])
})
