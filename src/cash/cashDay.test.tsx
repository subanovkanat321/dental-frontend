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
    movements: [], depositsSom: 0, withdrawalsSom: 0, closingSom: 5600, closed: false, refunds: [], cashRefundsSom: 0, ...extra,
  }
  return { ...v, closingSom: (v.openingSom ?? 0) + v.cashInSom - v.expensesSom - v.cashRefundsSom + v.depositsSom - v.withdrawalsSom }
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
  expect(within(block).getByRole('list', { name: 'Расходы наличными' })).toHaveTextContent(/Материалы · Перчатки−400 сом/)

  await user.click(within(block).getByRole('button', { name: /Забрать из кассы/ }))
  const form = within(block).getByRole('form', { name: 'Забрать из кассы' })
  await user.type(within(form).getByLabelText('Сумма, сом'), '2500')
  await user.type(within(form).getByLabelText('Причина'), 'Сдали в банк')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(block).findByRole('list', { name: 'Положили и забрали' })).toHaveTextContent(/Забрали · Сдали в банк · Айгерим−2\s500 сом/)
  expect(within(block).getByRole('definition', { name: 'Остаток на конец' })).toHaveTextContent(/3\s100 сом/)

  await user.click(within(block).getByRole('button', { name: 'Закрыть день' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Закрыть день' }))
  expect(await within(block).findByText(/День закрыт/)).toHaveTextContent(/Айгерим · остаток 3\s100 сом/)
  expect(within(block).queryByRole('button', { name: /Забрать из кассы/ })).not.toBeInTheDocument()
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
  // Первый раз — сразу поле «Сколько денег было в кассе утром?», без отдельной кнопки
  expect(within(block).getByText('не указано')).toBeInTheDocument()
  const form = await within(block).findByRole('form', { name: 'Остаток на начало' })
  expect(form).toHaveTextContent('Сколько денег было в кассе утром?')
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

test('касса дня: возврат аванса наличными — расход ящика, переводом — только для сведения', async () => {
  const current = view({
    cashRefundsSom: 3000,
    refunds: [
      { id: 1, amountSom: 3000, method: 'CASH', reason: 'Лечение отменили', patient: 'Айгуль Т.', by: 'Айгерим', at: new Date().toISOString() },
      { id: 2, amountSom: 1000, method: 'TRANSFER', reason: 'Переехали', patient: 'Нурлан Т.', at: new Date().toISOString() },
    ],
  })
  server.use(http.get('*/api/cash-day', () => HttpResponse.json(current)))
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Касса дня'))
  const block = await screen.findByRole('region', { name: 'Касса дня' })
  // 2 000 + 4 000 − 400 − 3 000
  expect(await within(block).findByRole('definition', { name: 'Остаток на конец' })).toHaveTextContent(/2\s600 сом/)
  const list = within(block).getByRole('list', { name: 'Возвраты аванса' })
  expect(list).toHaveTextContent(/Айгуль Т\. · Лечение отменили · Айгерим−3\s000 сом/)
  expect(list).toHaveTextContent(/Нурлан Т\. · Переехали · переводом, не из ящика−1\s000 сом/)
})
