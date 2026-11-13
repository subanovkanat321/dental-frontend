import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

type Me = Schemas['BookingViewsMe']

/**
 * «Чей расход» у обычного расхода (вымышленная клиника): руководитель выбирает «Клиника» или врача (по умолчанию —
 * врач из фильтра кассы), врач без права видеть всех видит «Запишется на вас». Скрытый врач в списке не нужен.
 */
const doctors = [...me.doctors!, { id: 3, fullName: 'Скрытый Врач', active: false, telegramLinked: false }]
const head: Me = { ...me, doctors }

function backend(who: Me, posted: Record<string, unknown>[]) {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([])),
    http.get('*/api/expenses', () => HttpResponse.json([])),
    http.get('*/api/expenses/shared', () => HttpResponse.json([])),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: ['Аренда', 'Материалы'], own: [] } satisfies Schemas['ExpenseControllerCategories'])),
    http.get('*/api/supplies/spending', () => HttpResponse.json({ revenueSom: 0, purchasedSom: 0, expensesSom: 0, usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0, lossesSom: 0 } satisfies Schemas['SpendingView'])),
    http.post('*/api/expenses', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      posted.push(body)
      return HttpResponse.json({ id: posted.length, spentOn: body.spentOn as string, amountSom: body.amountSom as number, category: body.category as string, repeatMonthly: false }, { status: 201 })
    }),
  )
}

async function fill(form: HTMLElement, amount: string) {
  const user = userEvent.setup()
  await user.type(within(form).getByRole('spinbutton', { name: 'Сумма, сом' }), amount)
  await choose(within(form).getByRole('combobox', { name: 'Статья' }), 'Аренда')
}

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

test('руководитель: «Вся клиника» — по умолчанию «Клиника», без врача; выбрал врача — расход на него', async () => {
  const posted: Record<string, unknown>[] = []
  backend(head, posted)
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  const form = await screen.findByRole('form', { name: 'Новый расход' })
  expect(within(form).getByRole('group', { name: 'Вид расхода' })).toHaveTextContent('Обычный расходОбщий — делится между врачами')
  const owner = within(form).getByRole('combobox', { name: 'Чей расход' })
  expect(owner).toHaveTextContent('Клиника')
  expect(within(form).getByText(/Клиника — расход клиники без врача/)).toBeInTheDocument()

  await fill(form, '1500')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ amountSom: 1500, category: 'Аренда' })
  expect(posted[0]).not.toHaveProperty('doctorId')

  // Скрытого врача в списке нет
  await user.click(owner)
  const list = await screen.findByRole('listbox')
  expect(within(list).getAllByRole('option').map((o) => o.textContent?.replace(/✓$/, ''))).toEqual(['Клиника', 'Айгерим Садыкова', 'Дастан Т.'])
  await user.click(within(list).getByRole('option', { name: /Дастан Т\./ }))
  await fill(form, '700')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(posted).toHaveLength(2))
  expect(posted[1]).toMatchObject({ amountSom: 700, doctorId: 2 })
})

test('руководитель: врач в фильтре кассы — «Чей расход» по умолчанию он', async () => {
  const posted: Record<string, unknown>[] = []
  backend(head, posted)
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  await choose(await screen.findByRole('combobox', { name: 'Чья касса' }), 'Дастан Т.')
  const form = screen.getByRole('form', { name: 'Новый расход' })
  await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Чей расход' })).toHaveTextContent('Дастан Т.'))
  await fill(form, '900')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ amountSom: 900, doctorId: 2 })
})

test('врач без права видеть всех: вместо выбора — «Запишется на вас»', async () => {
  const posted: Record<string, unknown>[] = []
  backend({ ...me, admin: false, doctorId: 2, clinic: { ...me.clinic!, independentDoctors: true } }, posted)
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  const form = await screen.findByRole('form', { name: 'Новый расход' })
  expect(within(form).getByRole('button', { name: 'Мой расход' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(form).queryByRole('combobox', { name: 'Чей расход' })).not.toBeInTheDocument()
  expect(within(form).getByLabelText('Чей расход')).toHaveTextContent('Запишется на вас: Дастан Т.')
  // Общий расход — без строки «на вас»: он делится, ключ виден
  await user.click(within(form).getByRole('button', { name: 'Общий — делится между врачами' }))
  expect(within(form).queryByLabelText('Чей расход')).not.toBeInTheDocument()
  expect(within(form).getByRole('combobox', { name: 'Как делить' })).toHaveTextContent('По креслам')
})

test('«Врачи работают независимо», руководитель без кресла: «Клиника» — расход руководителя, не делится; «＋ Расход» — то же поле', async () => {
  const posted: Record<string, unknown>[] = []
  backend({ ...head, doctorId: undefined, clinic: { ...me.clinic!, independentDoctors: true } }, posted)
  server.use(http.get('*/api/appointments/revenue', () => HttpResponse.json({
    totalSom: 0, paidCount: 0, unpaidCount: 0, freeCount: 0, prepaidCount: 0, byMethod: {}, days: [],
    cash: { totalSom: 0, paymentsCount: 0, depositsSom: 0, byMethod: {}, days: [], openingDebtsSom: 0 },
  } satisfies Schemas['RevenueView'])))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Расход' }))
  const dialog = await screen.findByRole('dialog', { name: 'Новый расход' })
  const owner = within(dialog).getByRole('combobox', { name: 'Чей расход' })
  expect(owner).toHaveTextContent(/Клиника.*руководитель/)
  expect(within(dialog).getByText(/в их «Чистыми» не попадает/)).toBeInTheDocument()
  await choose(owner, 'Айгерим Садыкова')
  await fill(dialog, '300')
  await user.click(within(dialog).getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(posted).toHaveLength(1))
  expect(posted[0]).toMatchObject({ amountSom: 300, doctorId: 1 })
})
