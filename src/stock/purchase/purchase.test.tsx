import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../../api/client'
import { readDeepLink } from '../../lib/deepLink'
import { findSub, me, renderApp } from '../../test/fixtures'
import { server } from '../../test/server'
import { waitForSlow } from '../../test/wait'

type List = Schemas['PurchaseViewsPurchaseList']
type Item = Schemas['PurchaseViewsDraftItem']

afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

// Поставщики и материалы вымышленные; пациентов в «Заказе» нет вовсе
const dent: Schemas['PurchaseViewsSupplierView'] = { id: 7, name: 'Дент-Маркет', phone: '996555111222', note: 'доставка в тот же день', archived: false }
const composite: Item = { supplyId: 11, name: 'Композит Filtek A2', unit: 'шт', quantity: 1, minQuantity: 2, low: true, wanted: false, usedMonth: 6,
  suggested: 7, toOrder: 7, lastPriceSom: 300 }
const gloves: Item = { supplyId: 12, name: 'Перчатки M', unit: 'уп', quantity: 3, minQuantity: 2, low: false, wanted: true, usedMonth: 0,
  suggested: 1, toOrder: 2, orderQuantity: 2 }
const message = 'Здравствуйте! Заказ от «Стоматология «Тест»»:\n• Композит Filtek A2 — 7 шт\n• Перчатки M — 2 уп\nДоставка: ул. Тестовая, 1. Спасибо!'
const draft: List = {
  count: 3,
  groups: [
    { supplierId: 7, supplierName: 'Дент-Маркет', supplierPhone: '996555111222', supplierNote: 'доставка в тот же день', items: [composite, gloves], message },
    { items: [{ ...composite, supplyId: 13, name: 'Иглы карпульные', toOrder: 3, suggested: 3, lastPriceSom: undefined }] },
  ],
  orders: [],
}
const sentOrder: Schemas['PurchaseViewsOrderView'] = {
  id: 40, supplierId: 7, supplierName: 'Дент-Маркет', supplierPhone: '996555111222', status: 'SENT', sentAt: '2026-11-10T04:00:00Z',
  items: [
    { id: 401, supplyId: 11, name: 'Композит Filtek A2', unit: 'шт', quantity: 5, lastPriceSom: 300 },
    { id: 402, supplyId: 12, name: 'Перчатки M', unit: 'уп', quantity: 2 },
  ],
}

function backend(list: List) {
  const calls: { path: string; body?: unknown }[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/purchases', () => HttpResponse.json(list)),
    http.get('*/api/purchases/count', () => HttpResponse.json({ count: list.count } satisfies Schemas['PurchaseViewsCount'])),
    http.get('*/api/suppliers', () => HttpResponse.json([dent])),
    http.put('*/api/supplies/:id/order', async ({ params, request }) => {
      calls.push({ path: `order ${params.id}`, body: await request.json() })
      return HttpResponse.json({ id: Number(params.id), name: 'x', unit: 'шт', quantity: 1, minQuantity: 2, low: true, orderWanted: false } satisfies Schemas['SupplyView'])
    }),
    http.post('*/api/purchases', async ({ request }) => {
      calls.push({ path: 'send', body: await request.json() })
      return HttpResponse.json({ order: sentOrder, text: message } satisfies Schemas['PurchaseViewsSent'], { status: 201 })
    }),
    http.post('*/api/purchases/:id/receive', async ({ params, request }) => {
      calls.push({ path: `receive ${params.id}`, body: await request.json() })
      return HttpResponse.json({ ...sentOrder, status: 'RECEIVED' } satisfies Schemas['PurchaseViewsOrderView'])
    }),
  )
  return calls
}

test('ссылка утреннего «Пора заказать» ведёт в «Склад → Заказ»', () => {
  expect(readDeepLink('?screen=purchase')).toEqual({ page: 'stock', tab: 'purchase' })
  expect(readDeepLink('?screen=purchase&doctor=2')).toEqual({ page: 'stock', tab: 'purchase' })
})

test('«Склад → Заказ»: по поставщикам, число у подраздела, «Отправить в WhatsApp» — готовый текст', async () => {
  window.location.hash = '/stock'
  const calls = backend(draft)
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  renderApp()
  // Число у подраздела — позиций к заказу
  await userEvent.click(await findSub('Заказ · 3'))

  const group = await screen.findByRole('region', { name: 'Заказ у Дент-Маркет' })
  expect(group).toHaveTextContent('доставка в тот же день')
  expect(group).toHaveTextContent('осталось 1 шт · мин. 2 · за 30 дней ушло 6 · было 300 сом/шт')
  expect(within(group).getByLabelText('Сколько заказать: Композит Filtek A2')).toHaveValue(7)
  expect(group).toHaveTextContent('добавлено вручную')
  // Без поставщика — выбрать «где берём», отправить нельзя
  const none = screen.getByRole('region', { name: 'Без поставщика' })
  expect(within(none).getByRole('combobox', { name: 'Поставщик: Иглы карпульные' })).toBeInTheDocument()
  expect(within(none).queryByRole('button', { name: 'Отправить в WhatsApp' })).toBeNull()

  await userEvent.click(within(group).getByRole('button', { name: 'Отправить в WhatsApp' }))
  await waitForSlow(() => expect(calls).toContainEqual({ path: 'send', body: { supplierId: 7, items: [{ supplyId: 11, quantity: 7 }, { supplyId: 12, quantity: 2 }] } }))
  await waitForSlow(() => expect(open).toHaveBeenCalled())
  const url = decodeURIComponent(String(open.mock.calls[0]![0]))
  expect(url).toContain('996555111222')
  expect(url).toContain('• Композит Filtek A2 — 7 шт')
  expect(url).toContain('Доставка: ул. Тестовая, 1. Спасибо!')
})

test('количество можно поправить: сохраняется своё, 0 — не заказываем', async () => {
  window.location.hash = '/stock/purchase'
  const calls = backend(draft)
  renderApp()
  const group = await screen.findByRole('region', { name: 'Заказ у Дент-Маркет' })
  const field = within(group).getByLabelText('Сколько заказать: Композит Filtek A2')
  await userEvent.clear(field)
  await userEvent.type(field, '4{Enter}')
  await waitForSlow(() => expect(calls).toContainEqual({ path: 'order 11', body: { supplierId: 7, wanted: false, quantity: 4 } }))

  await userEvent.click(within(group).getByRole('button', { name: 'Ещё: Перчатки M' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Как предложено: 1' }))
  await waitForSlow(() => expect(calls).toContainEqual({ path: 'order 12', body: { supplierId: 7, wanted: true } }))
})

test('«Пришло»: по позициям, своё количество и цена — сумма за позицию', async () => {
  window.location.hash = '/stock/purchase'
  const calls = backend({ count: 0, groups: [], orders: [sentOrder] })
  renderApp()
  const waiting = await screen.findByRole('region', { name: 'Отправлено — ждём' })
  expect(waiting).toHaveTextContent('Композит Filtek A2 — 5 шт, Перчатки M — 2 уп')
  expect(waiting).toHaveTextContent('Отправлен 10 ноября')
  await userEvent.click(within(waiting).getByRole('button', { name: 'Пришло: Дент-Маркет' }))

  const dialog = await screen.findByRole('dialog', { name: 'Пришло: «Дент-Маркет»' })
  // Пришло 4 композита (по прошлой цене 300), перчаток не было
  const composite = within(dialog).getByLabelText('Пришло: Композит Filtek A2')
  expect(composite).toHaveValue(5)
  await userEvent.clear(composite)
  await userEvent.type(composite, '4')
  await userEvent.clear(within(dialog).getByLabelText('Пришло: Перчатки M'))
  await userEvent.type(within(dialog).getByLabelText('Пришло: Перчатки M'), '0')
  expect(dialog).toHaveTextContent('Итого: 1 200 сом')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Принять на склад' }))
  await waitForSlow(() => expect(calls).toContainEqual({ path: 'receive 40', body: { items: [
    { itemId: 401, received: 4, costSom: 1200 }, { itemId: 402, received: 0 },
  ] } }))
  await waitForSlow(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('карточка материала: где берём и цены у поставщиков — дешевле сверху', async () => {
  window.location.hash = '/stock'
  backend({ count: 0, groups: [], orders: [] })
  server.use(
    http.get('*/api/supplies', () => HttpResponse.json([{ id: 11, name: 'Композит Filtek A2', unit: 'шт', quantity: 5, minQuantity: 2, low: false,
      orderWanted: false, supplierId: 7, supplierName: 'Дент-Маркет' }] satisfies Schemas['SupplyView'][])),
    http.get('*/api/supplies/:id/history', () => HttpResponse.json([])),
    http.get('*/api/supplies/:id/prices', () => HttpResponse.json({
      suppliers: [
        { supplierId: 8, supplierName: 'Медсклад', priceSom: 280, day: '2026-10-02', deliveries: 1 },
        { supplierId: 7, supplierName: 'Дент-Маркет', priceSom: 300, day: '2026-11-10', deliveries: 3 },
      ],
      entries: [],
    } satisfies Schemas['PurchaseViewsPriceHistory'])),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: 'Композит Filtek A2' }))
  const panel = screen.getByRole('complementary', { name: 'Материал' })
  await userEvent.click(within(panel).getByRole('button', { name: /Заказ и цены/ }))
  const prices = await within(panel).findByRole('region', { name: 'Цены у поставщиков' })
  const rows = within(prices).getAllByRole('listitem')
  expect(rows[0]).toHaveTextContent('Медсклад · 2 октября280 сом/шт')
  expect(within(rows[0]!).getByText('280 сом/шт')).toHaveClass('cheapest')
  expect(rows[1]).toHaveTextContent('Дент-Маркет · 10 ноября300 сом/шт')
})

test('«Поставщики»: пока открыта форма, «Готово» нет — введённое не пропадёт; «Добавить» сохраняет', async () => {
  window.location.hash = '/stock'
  backend(draft)
  const saved: unknown[] = []
  server.use(http.post('*/api/suppliers', async ({ request }) => {
    saved.push(await request.json())
    return HttpResponse.json({ id: 8, name: 'Мед-Склад', phone: '996700000001', archived: false } satisfies Schemas['PurchaseViewsSupplierView'], { status: 201 })
  }))
  renderApp()
  await userEvent.click(await findSub('Заказ · 3'))
  await userEvent.click(await screen.findByRole('button', { name: 'Поставщики' }))
  const dialog = await screen.findByRole('dialog', { name: 'Поставщики' })
  expect(within(dialog).getByRole('button', { name: 'Готово' })).toBeInTheDocument()

  await userEvent.click(within(dialog).getByRole('button', { name: '＋ Поставщик' }))
  expect(within(dialog).queryByRole('button', { name: 'Готово' })).toBeNull()
  await userEvent.type(within(dialog).getByLabelText('Название поставщика'), 'Мед-Склад')
  await userEvent.type(within(dialog).getByLabelText('Телефон / WhatsApp'), '+996700000001')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }))
  await waitForSlow(() => expect(saved).toEqual([{ name: 'Мед-Склад', phone: '+996700000001' }]))
  expect(await within(dialog).findByRole('button', { name: 'Готово' })).toBeInTheDocument()
})
