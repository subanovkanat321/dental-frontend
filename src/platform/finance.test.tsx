import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

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
    return k === 11 ? { month: m, incomeSom: 10470, expenseSom: 3055, profitSom: 7415 }
      : k === 10 ? { month: m, incomeSom: 0, expenseSom: 1200, profitSom: -1200 }
        : { month: m, incomeSom: 0, expenseSom: 0, profitSom: 0 }
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
    categories: ['Claude (разработка)', 'Реклама', 'Сервер и домен', 'SMS-провайдер (пополнение)', 'Прочее'],
  }
}

const emptyMonth = (month: string): Finance => ({
  month, incomeSom: 0, expenseSom: 0, profitSom: 0,
  expenses: [{ key: 'AI', label: 'ИИ в приложении', som: 0, auto: true, count: 0, needsPrice: false },
    { key: 'SMS', label: 'SMS', som: 0, auto: true, count: 0, needsPrice: true }],
  income: [], entries: [], history: history(month).map((m) => ({ ...m, incomeSom: 0, expenseSom: 0, profitSom: 0 })),
  settings: { lastUsdRate: 87 }, categories: [],
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
  await user.click(await screen.findByRole('tab', { name: 'Финансы' }))
  expect(await screen.findByLabelText('Доходы за месяц')).toHaveTextContent('10 470 сом')
  expect(screen.getByLabelText('Расходы за месяц')).toHaveTextContent('3 055 сом')
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
  expect(await screen.findByText('В этом месяце оплат от клиник не было.')).toBeInTheDocument()
  expect(screen.getByText('В этом месяце ручных расходов нет.')).toBeInTheDocument()
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
      const updated: Schemas['PlatformExpensesExpense'] = { id: 6 }
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
  await user.click(await screen.findByRole('tab', { name: 'Финансы' }))
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
  await user.click(await screen.findByRole('tab', { name: 'Финансы' }))
  await user.click(await screen.findByRole('button', { name: 'Добавить расход' }))
  const form = screen.getByRole('form', { name: 'Новый расход' })
  await user.type(within(form).getByLabelText('Статья'), 'Реклама')
  await user.click(within(form).getByRole('button', { name: 'В долларах' }))
  await user.type(within(form).getByLabelText('Сумма, $'), '10')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await within(form).findByText('Курс — больше нуля, до двух знаков')).toBeInTheDocument()
})

test('не владельцу вкладки «Финансы» нет', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: false, platform: true })))
  renderApp()
  expect(await screen.findByRole('tab', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Финансы' })).not.toBeInTheDocument()
})
