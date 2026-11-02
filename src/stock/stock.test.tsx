import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { todayIn } from '../lib/time'
import { choose } from '../test/select'

type Supply = Schemas['SupplyView']

beforeEach(() => {
  window.location.hash = '/stock'
})
afterEach(() => {
  window.location.hash = ''
})

/** Фальшивый склад: движения меняют остаток, как на сервере. */
function backend(list: Supply[], who: Schemas['BookingViewsMe'] = me) {
  const stock = list.map((s) => ({ ...s }))
  const moves: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/supplies', () => HttpResponse.json(stock)),
    http.get('*/api/supplies/:id/history', () => HttpResponse.json([
      { delta: 10, reason: 'DELIVERY', doctorName: 'Айгерим Садыкова', createdAt: '2026-10-20T05:00:00Z', costSom: 2500 },
    ])),
    http.post('*/api/supplies/:id/move', async ({ request, params }) => {
      const body = (await request.json()) as { delta: number }
      moves.push(body)
      const s = stock.find((x) => x.id === Number(params.id))!
      s.quantity = s.quantity! + body.delta
      s.low = s.quantity <= s.minQuantity!
      return HttpResponse.json(s)
    }),
  )
  return moves
}

const glove: Supply = { id: 1, name: 'Перчатки', unit: 'уп', quantity: 12, minQuantity: 3, low: false }
const anesthetic: Supply = { id: 2, name: 'Анестетик', unit: 'карп.', quantity: 2, minQuantity: 5, low: true }
const cotton: Supply = { id: 3, name: 'Валики', unit: 'уп', quantity: 0, minQuantity: 1, low: true, orderedAt: '2026-10-30T05:00:00Z', orderedBy: 'регистратура' }

test('заканчивается — сверху; фильтр «Только заканчивается» и поиск', async () => {
  backend([glove, anesthetic, cotton])
  renderApp()
  const table = await screen.findByRole('table', { name: 'Материалы' })
  const names = () => within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent)
  expect(names()).toEqual(['Анестетик', 'Валики', 'Перчатки'])
  expect(table).toHaveTextContent('закончился')
  expect(table).toHaveTextContent('заказан')
  expect(table).toHaveTextContent('нужно заказать')

  await userEvent.click(screen.getByLabelText(/Только заканчивается \(2\)/))
  expect(names()).toEqual(['Анестетик', 'Валики'])
  await userEvent.type(screen.getByLabelText('Поиск материала'), 'вал')
  expect(names()).toEqual(['Валики'])
})

test('карточка материала: пришла поставка с ценой — остаток растёт, «мало» уходит; история с ценой за штуку', async () => {
  const moves = backend([anesthetic])
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Анестетик' }))
  const panel = screen.getByRole('complementary', { name: 'Материал' })
  expect(panel).toHaveTextContent('Осталось: 2 карп. — мало')
  expect(await within(panel).findByText(/по 250 сом\/карп\./)).toBeInTheDocument()

  const amount = within(panel).getByLabelText('Сколько, карп.')
  await userEvent.clear(amount)
  await userEvent.type(amount, '10')
  await userEvent.type(within(panel).getByLabelText(/Сколько заплатили/), '3000')
  await userEvent.click(within(panel).getByRole('button', { name: '＋ Пришла поставка' }))

  expect(await within(panel).findByRole('status')).toHaveTextContent(/Принято 10 карп\. · 3\s000 сом/)
  expect(await within(panel).findByText('Осталось: 12 карп.')).toBeInTheDocument()
  expect(moves).toEqual([{ delta: 10, reason: 'DELIVERY', costSom: 3000 }])
})

test('пустой склад — «Добавить типовой набор»', async () => {
  let added = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/supplies', () => HttpResponse.json(added ? [glove] : [])),
    http.post('*/api/supplies/samples', () => {
      added = true
      return HttpResponse.json({ added: 1 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Добавить типовой набор' }))
  expect(await screen.findByRole('button', { name: 'Перчатки' })).toBeInTheDocument()
})

test('новый материал: «свой склад у каждого врача» — админ выбирает, чей', async () => {
  let created: unknown
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, clinic: { ...me.clinic, separateSupplies: true } })),
    http.get('*/api/supplies', () => HttpResponse.json([])),
    http.post('*/api/supplies', async ({ request }) => {
      created = await request.json()
      return HttpResponse.json({ id: 9, name: 'Композит', unit: 'шпр', quantity: 4, minQuantity: 2, low: false, doctorId: 2, doctorName: 'Дастан Т.' },
        { status: 201 })
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: '＋ Материал' }))
  const panel = screen.getByRole('complementary', { name: 'Новый материал' })
  await userEvent.type(within(panel).getByLabelText('Название'), 'Композит')
  await userEvent.clear(within(panel).getByLabelText('Единица'))
  await userEvent.type(within(panel).getByLabelText('Единица'), 'шпр')
  await userEvent.type(within(panel).getByLabelText('Сколько есть'), '4')
  await userEvent.clear(within(panel).getByLabelText('Минимум'))
  await userEvent.type(within(panel).getByLabelText('Минимум'), '2')
  await choose(within(panel).getByLabelText('Чей склад'), 'Дастан Т.')
  await userEvent.click(within(panel).getByRole('button', { name: 'Добавить' }))

  await vi.waitFor(() => expect(created).toEqual({ name: 'Композит', unit: 'шпр', quantity: 4, minQuantity: 2, doctorId: 2 }))
})

test('«−1» в списке списывает одну штуку; «Расходы на склад» — покупки месяца и по материалам', async () => {
  const moves = backend([glove])
  server.use(http.get('*/api/supplies/spending', () => HttpResponse.json({
    purchasedSom: 5000, usedSom: 1200, revenueSom: 50000, unpricedDeliveries: 1, unpricedUsed: 0,
    months: [{ month: '2026-09-01', purchasedSom: 3000 }, { month: '2026-10-01', purchasedSom: 5000 }],
    items: [{ supplyId: 1, name: 'Перчатки', unit: 'уп', bought: 10, boughtSom: 5000, used: 2, usedSom: 1000 }],
  } satisfies Schemas['SpendingView'])))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Списать 1: Перчатки' }))
  expect(await screen.findByText('11 уп')).toBeInTheDocument()
  expect(moves).toEqual([{ delta: -1 }])
  expect(screen.getByText(/добавить типовой набор/)).toBeInTheDocument()
  // Списали по ошибке — «Вернуть» сразу под рукой: пересчёт +1
  const undo = screen.getByRole('status')
  expect(undo).toHaveTextContent('Списано 1 уп: Перчатки')
  await userEvent.click(within(undo).getByRole('button', { name: 'Вернуть' }))
  expect(await screen.findByText('12 уп')).toBeInTheDocument()
  expect(moves).toEqual([{ delta: -1 }, { delta: 1, reason: 'CORRECTION' }])
  expect(screen.queryByText(/Списано 1 уп/)).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Расходы на склад' }))
  const block = await screen.findByRole('region', { name: 'Расходы на склад' })
  expect(await within(block).findByText(/10% выручки/)).toBeInTheDocument()
  expect(block).toHaveTextContent('Поставок без суммы: 1')
  expect(within(within(block).getByRole('table', { name: 'Расходы по материалам' })).getByText('Перчатки')).toBeInTheDocument()
})

test('«Расходы на склад» за месяц — с первого по последнее число, а не только первое', async () => {
  backend([glove])
  const periods: string[] = []
  server.use(http.get('*/api/supplies/spending', ({ request }) => {
    const url = new URL(request.url)
    periods.push(`${url.searchParams.get('from')}..${url.searchParams.get('to')}`)
    return HttpResponse.json({ purchasedSom: 0, usedSom: 0, months: [], items: [] } satisfies Schemas['SpendingView'])
  }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Расходы на склад' }))
  // «‹ Ноябрь 2026 ›»: нажать на месяц — окошко с месяцами года, выбрать февраль
  const picker = await screen.findByRole('group', { name: 'Месяц расходов на склад' })
  await userEvent.click(within(picker).getByRole('button', { expanded: false }))
  const year = Number(todayIn().slice(0, 4))
  while (Number(within(picker).getByRole('dialog').querySelector('.mp-year b')!.textContent) > 2026) {
    await userEvent.click(within(picker).getByRole('button', { name: 'Предыдущий год' }))
  }
  expect(year).toBeGreaterThanOrEqual(2026)
  await userEvent.click(within(picker).getByRole('button', { name: 'Февраль 2026' }))
  await vi.waitFor(() => expect(periods).toContain('2026-02-01..2026-02-28'))
})
