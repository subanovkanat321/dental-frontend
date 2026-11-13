import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, querySub, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { todayIn } from '../lib/time'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Supply = Schemas['SupplyView']
type Me = Schemas['BookingViewsMe']

beforeEach(() => {
  window.location.hash = '/stock/spending'
})
afterEach(() => {
  window.location.hash = ''
})

const glove: Supply = { id: 1, name: 'Перчатки', unit: 'уп', quantity: 12, minQuantity: 3, low: false }
const bur: Supply = { id: 5, name: 'Бор алмазный', unit: 'шт', quantity: 3, minQuantity: 1, low: false, doctorId: 1, doctorName: 'Айгерим Садыкова' }

const delivery = (d: Partial<Schemas['SpendingViewDelivery']> & { id: number; supplyId: number }): Schemas['SpendingViewDelivery'] => ({
  name: 'Перчатки', unit: 'уп', archived: false, quantity: 10, costSom: 2500, day: todayIn(), ...d,
})

/** Фальшивый склад и «Расходы на склад»: поставка меняет остаток и попадает в список. */
function backend(list: Supply[], who: Me = me, deliveries: Schemas['SpendingViewDelivery'][] = []) {
  const stock = list.map((s) => ({ ...s }))
  const rows = [...deliveries]
  const moves: unknown[] = []
  const created: unknown[] = []
  const spending: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/supplies', () => HttpResponse.json(stock)),
    http.get('*/api/supplies/:id/history', () => HttpResponse.json([
      { delta: 10, reason: 'DELIVERY', doctorName: 'Айгерим Садыкова', createdAt: '2026-10-20T05:00:00Z', costSom: 2500 },
    ] satisfies Schemas['MovementView'][])),
    http.get('*/api/supplies/spending', ({ request }) => {
      spending.push(new URL(request.url).search)
      return HttpResponse.json({
        purchasedSom: rows.reduce((t, d) => t + (d.costSom ?? 0), 0), usedSom: 0, unpricedUsed: 0, unpricedDeliveries: 0, lossesSom: 0,
        revenueSom: 100000, items: [], months: [], deliveries: rows,
      } satisfies Schemas['SpendingView'])
    }),
    http.post('*/api/supplies', async ({ request }) => {
      const body = (await request.json()) as { name: string; unit: string; doctorId?: number }
      created.push(body)
      const s: Supply = { id: 9, name: body.name, unit: body.unit, quantity: 0, minQuantity: 1, low: true, doctorId: body.doctorId }
      stock.push(s)
      return HttpResponse.json(s, { status: 201 })
    }),
    http.post('*/api/supplies/:id/move', async ({ request, params }) => {
      const body = (await request.json()) as { delta: number; costSom?: number }
      moves.push(body)
      const s = stock.find((x) => x.id === Number(params.id))!
      s.quantity += body.delta
      rows.unshift(delivery({ id: 100 + rows.length, supplyId: s.id, name: s.name, unit: s.unit, quantity: body.delta, costSom: body.costSom }))
      return HttpResponse.json(s)
    }),
  )
  return { moves, created, spending }
}

test('список поставок месяца: строка открывает карточку материала с историей; удалённый — не открывается', async () => {
  backend([glove], me, [
    delivery({ id: 2, supplyId: 1, quantity: 5, costSom: undefined }),
    delivery({ id: 1, supplyId: 7, name: 'Старый композит', unit: 'шпр', archived: true, quantity: 2, costSom: 1800 }),
  ])
  renderApp()
  const block = await screen.findByRole('region', { name: 'Расходы на склад' })
  expect(block).toHaveTextContent('Здесь — сколько потратили на материалы: каждая поставка с суммой из карточки материала.')
  const table = await within(block).findByRole('table', { name: 'Поставки за месяц' })
  const [, first, second] = within(table).getAllByRole('row')
  expect(first).toHaveTextContent(/Перчатки.*5 уп.*без суммы/)
  expect(second).toHaveTextContent(/Старый композит \(удалён\).*2 шпр.*1\s800 сом/)
  // Удалённый материал — без карточки: строка обычная
  expect(second).not.toHaveClass('clickable')
  await userEvent.click(within(second!).getAllByRole('cell')[2]!)
  expect(screen.queryByRole('complementary', { name: 'Материал' })).not.toBeInTheDocument()
  // Нажатие по строке (не только по названию) — карточка материала с историей
  await userEvent.click(within(first!).getAllByRole('cell')[3]!)
  const card = await screen.findByRole('complementary', { name: 'Материал' })
  expect(within(card).getByRole('heading', { name: 'Перчатки' })).toBeInTheDocument()
  expect(await within(card).findByText('+10')).toBeInTheDocument()
})

test('«＋ Поставка» отсюда: материал, сколько, сумма, дата — тот же запрос, что «Пришла поставка»; список обновляется', async () => {
  const { moves } = backend([glove, { ...glove, id: 2, name: 'Анестетик', unit: 'карп.' }])
  renderApp()
  const block = await screen.findByRole('region', { name: 'Расходы на склад' })
  expect(await within(block).findByText('В этом месяце поставок не было')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '＋ Поставка' }))
  const sheet = within(screen.getByRole('complementary', { name: 'Новая поставка' }))
  // Один склад на всех — «Чей склад» не спрашиваем
  expect(sheet.queryByLabelText('Чей склад')).not.toBeInTheDocument()
  expect(sheet.getByRole('button', { name: 'Добавить поставку' })).toBeDisabled()
  await choose(sheet.getByLabelText('Материал'), 'Перчатки')
  await userEvent.clear(sheet.getByLabelText('Сколько, уп'))
  await userEvent.type(sheet.getByLabelText('Сколько, уп'), '10')
  await userEvent.type(sheet.getByLabelText(/Сколько заплатили/), '2500')
  await userEvent.click(sheet.getByRole('button', { name: 'Добавить поставку' }))

  expect(await sheet.findByRole('status')).toHaveTextContent('Принято 10 уп: Перчатки · 2 500 сом')
  expect(moves).toEqual([{ delta: 10, reason: 'DELIVERY', costSom: 2500 }])
  const table = await within(block).findByRole('table', { name: 'Поставки за месяц' })
  expect(table).toHaveTextContent(/Перчатки.*10 уп.*2\s500 сом/)
})

test('«＋ Новый материал» в листе поставки: заводится с остатком 0 и сразу принимается поставкой', async () => {
  const { moves, created } = backend([glove])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Поставка' }))
  const sheet = within(screen.getByRole('complementary', { name: 'Новая поставка' }))
  await choose(sheet.getByLabelText('Материал'), '＋ Новый материал')
  await userEvent.type(sheet.getByLabelText('Название'), 'Композит')
  await userEvent.clear(sheet.getByLabelText('Единица'))
  await userEvent.type(sheet.getByLabelText('Единица'), 'шпр')
  await userEvent.clear(sheet.getByLabelText('Сколько, шпр'))
  await userEvent.type(sheet.getByLabelText('Сколько, шпр'), '4')
  await userEvent.type(sheet.getByLabelText(/Сколько заплатили/), '3600')
  await userEvent.click(sheet.getByRole('button', { name: 'Добавить поставку' }))

  expect(await sheet.findByRole('status')).toHaveTextContent('Принято 4 шпр: Композит · 3 600 сом')
  expect(created).toEqual([{ name: 'Композит', unit: 'шпр', quantity: 0, minQuantity: 1 }])
  expect(moves).toEqual([{ delta: 4, reason: 'DELIVERY', costSom: 3600 }])
})

test('свой склад у каждого врача: руководитель выбирает склад — материалы только этого склада', async () => {
  const separate: Me = { ...me, clinic: { ...me.clinic!, separateSupplies: true } }
  const { moves } = backend([glove, bur], separate, [delivery({ id: 1, supplyId: 5, name: 'Бор алмазный', unit: 'шт', doctorId: 1, doctorName: 'Айгерим Садыкова' })])
  renderApp()
  const table = await screen.findByRole('table', { name: 'Поставки за месяц' })
  expect(within(table).getByRole('columnheader', { name: 'Чей склад' })).toBeInTheDocument()
  expect(table).toHaveTextContent('Айгерим Садыкова')
  await userEvent.click(screen.getByRole('button', { name: '＋ Поставка' }))
  const sheet = within(screen.getByRole('complementary', { name: 'Новая поставка' }))
  await choose(sheet.getByLabelText('Чей склад'), 'Айгерим Садыкова')
  await choose(sheet.getByLabelText('Материал'), 'Бор алмазный')
  await userEvent.click(sheet.getByRole('button', { name: 'Добавить поставку' }))
  await waitForSlow(() => expect(moves).toEqual([{ delta: 1, reason: 'DELIVERY' }]))
})

test('права: врач в независимой клинике со своим складом — «Мои закупки» по своему складу; без этого и ассистенту — нет', async () => {
  const independent: Me = { ...me, admin: false, clinic: { ...me.clinic!, independentDoctors: true, separateSupplies: true } }
  backend([glove, bur], independent)
  renderApp()
  const block = await screen.findByRole('region', { name: 'Мои закупки' })
  expect(block).toHaveTextContent('Здесь — сколько вы потратили на материалы своего склада')
  expect(querySub('Расходы на склад')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: '＋ Поставка' }))
  const sheet = within(screen.getByRole('complementary', { name: 'Новая поставка' }))
  // Свой склад — без выбора; общие материалы сюда не принимают
  expect(sheet.queryByLabelText('Чей склад')).not.toBeInTheDocument()
  await userEvent.click(sheet.getByLabelText('Материал'))
  expect(await screen.findByRole('option', { name: /Бор алмазный/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Перчатки/ })).not.toBeInTheDocument()
})

test.each<[string, Me]>([
  ['врачу без независимости', { ...me, admin: false, clinic: { ...me.clinic!, separateSupplies: true } }],
  ['ассистенту', { ...me, admin: false, doctorId: undefined, assistantOf: [1], clinic: { ...me.clinic!, independentDoctors: true, separateSupplies: true } }],
])('%s подраздела нет', async (_, who) => {
  backend([glove], who)
  window.location.hash = '/stock'
  renderApp()
  await screen.findByRole('heading', { name: /Склад/ })
  expect(querySub('Мои закупки')).toBeNull()
  expect(querySub('Расходы на склад')).toBeNull()
})
