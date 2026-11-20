import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { me, renderApp, findSub } from '../test/fixtures'
import { server } from '../test/server'
import { subsOf } from '../layout/nav'

type Day = Schemas['CashDaysView']

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

/** День кассы как его считает сервер (CashDays): начало + наличные − расходы из кассы + внесения − изъятия. */
function view(extra: Partial<Day> = {}): Day {
  const v: Day = {
    day: todayIn(), openingSom: 2000, openingSource: 'PREVIOUS', openingFrom: '2026-11-19',
    inByMethod: { CASH: 4000, TRANSFER: 1500, CARD: 700 }, inSom: 6200, cashInSom: 4000,
    expenses: [{ id: 1, category: 'Материалы', comment: 'Перчатки', amountSom: 400 }], expensesSom: 400,
    movements: [], depositsSom: 0, withdrawalsSom: 0, closingSom: 5600, closed: false, ...extra,
  }
  return { ...v, closingSom: (v.openingSom ?? 0) + v.cashInSom - v.expensesSom + v.depositsSom - v.withdrawalsSom }
}

test('касса дня: итог столбиком, приход по способам, изъятие с причиной и закрытие дня', async () => {
  let current = view()
  const sent: { path: string; body: unknown }[] = []
  server.use(
    http.get('*/api/cash-day', () => HttpResponse.json(current)),
    http.post('*/api/cash-day/movements', async ({ request }) => {
      const body = (await request.json()) as { amountSom: number; reason: string; kind: 'IN' | 'OUT' }
      sent.push({ path: 'movements', body })
      current = view({ withdrawalsSom: body.amountSom, movements: [{ id: 7, kind: body.kind, amountSom: body.amountSom, reason: body.reason, by: 'Айгерим' }] })
      return HttpResponse.json(current)
    }),
    http.post('*/api/cash-day/close', async ({ request }) => {
      sent.push({ path: 'close', body: await request.json() })
      current = { ...current, closed: true, closedAt: new Date().toISOString(), closedBy: 'Айгерим', closedSom: current.closingSom }
      return HttpResponse.json(current)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Касса дня'))
  const block = await screen.findByRole('region', { name: 'Касса дня' })
  const sum = await within(block).findByRole('definition', { name: 'Остаток на конец' })
  expect(sum).toHaveTextContent(/5\s600 сом/)
  expect(within(block).getByLabelText('Приход по способам')).toHaveTextContent(/перевод 1\s500 сом · карта 700 сом — в ящик идут только наличные/)
  expect(within(block).getByRole('list', { name: 'Расходы из кассы' })).toHaveTextContent(/Материалы · Перчатки−400 сом/)

  await user.click(within(block).getByRole('button', { name: '− Изъятие' }))
  const form = within(block).getByRole('form', { name: 'Изъятие из кассы' })
  await user.type(within(form).getByLabelText('Сумма, сом'), '2500')
  await user.type(within(form).getByLabelText('Причина'), 'Сдали в банк')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(block).findByRole('list', { name: 'Внесения и изъятия' })).toHaveTextContent(/Изъятие · Сдали в банк · Айгерим−2\s500 сом/)
  expect(within(block).getByRole('definition', { name: 'Остаток на конец' })).toHaveTextContent(/3\s100 сом/)

  await user.click(within(block).getByRole('button', { name: 'Закрыть день' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Закрыть день' }))
  expect(await within(block).findByText(/День закрыт/)).toHaveTextContent(/Айгерим · остаток 3\s100 сом/)
  expect(within(block).queryByRole('button', { name: '− Изъятие' })).not.toBeInTheDocument()
  expect(within(block).getByRole('button', { name: 'Открыть день' })).toBeInTheDocument()
  expect(sent).toEqual([
    { path: 'movements', body: { day: todayIn(), kind: 'OUT', amountSom: 2500, reason: 'Сдали в банк' } },
    { path: 'close', body: { day: todayIn() } },
  ])
})

test('касса дня: первый раз — «впишите остаток»; вписали — остаток на начало «вписан»', async () => {
  let current = view({ openingSom: undefined, openingSource: 'NONE', openingFrom: undefined, expenses: [], expensesSom: 0 })
  server.use(
    http.get('*/api/cash-day', () => HttpResponse.json(current)),
    http.put('*/api/cash-day/opening', async ({ request }) => {
      const body = (await request.json()) as { amountSom: number }
      current = view({ openingSom: body.amountSom, openingSource: 'MANUAL', openingFrom: undefined, expenses: [], expensesSom: 0 })
      return HttpResponse.json(current)
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Касса дня'))
  const block = await screen.findByRole('region', { name: 'Касса дня' })
  expect(await within(block).findByRole('note')).toHaveTextContent('Первый раз: впишите, сколько денег было в ящике')
  expect(within(block).getByText('не указан')).toBeInTheDocument()
  await user.click(within(block).getByRole('button', { name: 'Вписать остаток на начало' }))
  const form = within(block).getByRole('form', { name: 'Остаток на начало' })
  await user.type(within(form).getByLabelText('Сумма, сом'), '1500')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(within(block).getByRole('definition', { name: 'Остаток на конец' })).toHaveTextContent(/5\s500 сом/))
  expect(within(block).getByText('вписан')).toBeInTheDocument()
})

test('«Касса дня» — только тому, кто видит деньги всей клиники: не регистратуре и не врачу', () => {
  expect(subsOf('cash', me).map((s) => s.key)).toContain('day')
  expect(subsOf('cash', { ...me, admin: false, doctorId: 1 }).map((s) => s.key)).not.toContain('day')
  expect(subsOf('cash', { ...me, admin: false, reception: true, doctorId: undefined })).toEqual([])
})
