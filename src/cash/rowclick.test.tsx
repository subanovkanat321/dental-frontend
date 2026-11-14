import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { slotInstant, todayIn } from '../lib/time'
import { appointment, me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { DebtorsTab } from './DebtorsTab'

// «Вся строка кликабельна» в «Кассе» (src/lib/rowClick.ts): клик по ячейке открывает то же, что имя
// в строке; кнопки внутри строки делают своё.

beforeEach(() => {
  window.location.hash = '/cash'
})
afterEach(() => {
  window.location.hash = ''
})

const today = todayIn()

test('«Касса»: строка долга и строка оплаты открывают карточку приёма кликом по любой ячейке', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([
      { appointmentId: 7, patientId: 7, patient: 'Бакыт М.', doctorId: 1, doctor: 'Айгерим Садыкова', service: 'Пломба', startAt: `${today}T04:00:00Z`, chargeSom: 5000, paidSom: 0, debtSom: 5000 },
    ] satisfies Schemas['PaymentQueryDebt'][])),
    http.get('*/api/appointments/report', () => HttpResponse.json([
      { id: 8, patient: 'Айгуль Т.', doctor: 'Айгерим Садыкова', service: 'Чистка', startAt: slotInstant(today, 600), status: 'Состоялся', paidSom: 3000, method: 'CASH' },
    ] satisfies Schemas['AppointmentServiceReportRow'][])),
    http.get('*/api/appointments/7', () => HttpResponse.json(appointment(7, 1, '09:00', 'Бакыт М.', { status: 'DONE', chargeSom: 5000 }))),
    http.get('*/api/appointments/8', () => HttpResponse.json(appointment(8, 1, '10:00', 'Айгуль Т.', { status: 'DONE', chargeSom: 3000, paidSom: 3000 }))),
  )
  const user = userEvent.setup()
  renderApp()
  const debts = await screen.findByRole('table', { name: 'Долги пациентов' })
  await user.click(within(debts).getByText('Пломба'))
  const panel = await screen.findByRole('complementary', { name: 'Карточка приёма' })
  await waitForSlow(() => expect(panel).toHaveTextContent('Бакыт М.'))
  expect(within(debts).getAllByRole('row')[1]).toHaveClass('clickable', 'active')

  const payments = await screen.findByRole('table', { name: 'Последние оплаты' })
  await user.click(within(payments).getByText('Чистка'))
  await waitForSlow(() => expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toHaveTextContent('Айгуль Т.'))
})

test('«Должники»: строка открывает пациента; «Принять оплату» — самый давний приём; «⋯» — пациент и визиты; старый долг — так же', async () => {
  server.use(http.get('*/api/opening-debts', () => HttpResponse.json([
    { id: 3, patientId: 9, patient: 'Пример Старый', amountSom: 2500, createdAt: '2026-11-10T06:00:00Z' },
  ] satisfies Schemas['OpeningDebtsView'][])))
  const onOpen = vi.fn()
  const onOpenPatient = vi.fn()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={createQueryClient({ queries: { retry: false } })}>
      <DebtorsTab pending={false} onOpen={onOpen} onOpenPatient={onOpenPatient} rows={[
        { appointmentId: 2, startAt: '2026-10-20T04:00:00Z', patientId: 5, patient: 'Айгуль С.', doctor: 'Нурболот', service: 'Чистка', chargeSom: 2000, paidSom: 0, debtSom: 2000, doctorId: 2 },
        { appointmentId: 1, startAt: '2026-10-01T04:00:00Z', patientId: 5, patient: 'Айгуль С.', doctor: 'Айгерим', service: 'Пломба', chargeSom: 5000, paidSom: 2000, debtSom: 3000, doctorId: 1 },
      ]} />
    </QueryClientProvider>,
  )
  const box = await screen.findByRole('region', { name: 'Должники' })
  const debtor = within(box).getByText(/2 визита в долг/).closest('li')!
  expect(debtor).toHaveClass('clickable')
  // Одна серая строка: последний визит, его врач, сколько визитов в долг; сумма справа
  expect(debtor).toHaveTextContent(/последний визит 20 окт.* · Нурболот · 2 визита в долг/)
  expect(debtor).toHaveTextContent(/5\s000 сом/)
  await user.click(within(debtor).getByText(/2 визита в долг/))
  expect(onOpenPatient).toHaveBeenLastCalledWith(5)

  // Главное действие — одно: приём с самым давним долгом (там оплата), строку не открывает
  expect(within(debtor).getAllByRole('button', { name: 'Принять оплату' })).toHaveLength(1)
  await user.click(within(debtor).getByRole('button', { name: 'Принять оплату' }))
  expect(onOpen).toHaveBeenLastCalledWith(1)
  expect(onOpenPatient).toHaveBeenCalledTimes(1)

  // «⋯»: открыть пациента и каждый визит в долг
  await user.click(within(debtor).getByRole('button', { name: 'Ещё: Айгуль С.' }))
  const menu = within(debtor).getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
    'Открыть пациента', expect.stringMatching(/^Визит 1 окт.* · Пломба · 3\s000 сом$/), expect.stringMatching(/^Визит 20 окт.* · Чистка · 2\s000 сом$/),
  ])
  await user.click(within(menu).getByRole('menuitem', { name: /Чистка/ }))
  expect(onOpen).toHaveBeenLastCalledWith(2)
  expect(onOpenPatient).toHaveBeenCalledTimes(1)

  const old = await screen.findByRole('region', { name: 'Старые долги из прежней программы' })
  const row = within(old).getByText(/перенесли/).closest('li')!
  await user.click(within(row).getByText(/перенесли/))
  expect(onOpenPatient).toHaveBeenLastCalledWith(9)
  await user.click(within(row).getByRole('button', { name: 'Ещё: Пример Старый' }))
  await user.click(within(row).getByRole('menuitem', { name: 'Открыть пациента' }))
  expect(onOpenPatient).toHaveBeenCalledTimes(3)
  await user.click(within(row).getByRole('button', { name: 'Принять оплату' }))
  expect(onOpenPatient).toHaveBeenCalledTimes(3)
  expect(within(row).getByRole('group', { name: 'Как отдали' })).toBeInTheDocument()
})

test('«Расходы»: строка открывает «Исправить», «✕» — нет; общий расход — тоже, чип «каждый месяц ✕» — нет', async () => {
  const month = today.slice(0, 7)
  let stopped = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/expenses', () => HttpResponse.json([
      { id: 1, spentOn: `${month}-01`, amountSom: 30000, category: 'Аренда', comment: 'кабинет', repeatMonthly: false },
    ] satisfies Schemas['ExpensesExpense'][])),
    http.get('*/api/expenses/shared', () => HttpResponse.json([
      { id: 5, spentOn: `${month}-01`, amountSom: 9000, category: 'Уборка', splitKey: 'EQUAL', repeatMonthly: true,
        shares: [{ doctorId: 1, doctor: 'Айгерим Садыкова', amountSom: 9000 }] },
    ] satisfies Schemas['ExpensesExpense'][])),
    http.put('*/api/expenses/5', () => { stopped++; return HttpResponse.json({}) }),
    http.get('*/api/expenses/categories', () => HttpResponse.json({ standard: ['Аренда', 'Уборка'], own: [] } satisfies Schemas['ExpenseControllerCategories'])),
    http.get('*/api/supplies/spending', () => HttpResponse.json({ revenueSom: 0, purchasedSom: 0, expensesSom: 30000, usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0, lossesSom: 0 } satisfies Schemas['SpendingView'])),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Расходы'))
  const table = await screen.findByRole('table', { name: 'Расходы' })
  await user.click(within(table).getByRole('button', { name: /^Удалить расход/ }))
  expect(screen.queryByRole('form', { name: 'Исправить расход' })).not.toBeInTheDocument()
  await user.click(within(table).getByText('кабинет'))
  expect(within(table).getByRole('form', { name: 'Исправить расход' })).toBeInTheDocument()
  // Повторный клик по строке форму не закрывает (закрывают «Отмена» и «✎»)
  await user.click(within(table).getByText('кабинет'))
  expect(within(table).getByRole('form', { name: 'Исправить расход' })).toBeInTheDocument()

  const shared = await screen.findByRole('list', { name: 'Общие расходы' })
  await user.click(within(shared).getByRole('button', { name: 'каждый месяц ✕' }))
  expect(stopped).toBe(1)
  expect(within(shared).queryByRole('form', { name: 'Исправить расход' })).not.toBeInTheDocument()
  await user.click(within(shared).getByText('Уборка'))
  const form = within(shared).getByRole('form', { name: 'Исправить расход' })
  // Клики внутри открытой формы строку не закрывают
  await user.click(form)
  expect(within(shared).getByRole('form', { name: 'Исправить расход' })).toBeInTheDocument()
  vi.restoreAllMocks()
})
