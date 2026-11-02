import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { groupByCategory } from './services'

beforeEach(() => {
  window.location.hash = '/settings/services'
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
})
afterEach(() => {
  window.location.hash = ''
})

test('услуги по категориям: стандартные по порядку, свои по алфавиту, без категории — последними', () => {
  const groups = groupByCategory([
    { id: 1, name: 'А', category: 'Хирургия' }, { id: 2, name: 'Б' }, { id: 3, name: 'В', category: 'Свои' },
    { id: 4, name: 'Г', category: 'Терапия' }, { id: 5, name: 'Д', category: 'Хирургия' },
  ])
  expect(groups.map((g) => g.category)).toEqual(['Терапия', 'Хирургия', 'Свои', null])
  expect(groups[1]!.items.map((s) => s.id)).toEqual([1, 5])
})

test('услуги: таблица по группам, правка и новая услуга', async () => {
  let list: Schemas['ServiceTypeView'][] = [
    { id: 1, name: 'Лечение кариеса', durationMinutes: 60, priceSom: 2500, category: 'Терапия', active: true },
    { id: 2, name: 'Консультация', durationMinutes: 30, active: false },
  ]
  const bodies: unknown[] = []
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(list)),
    http.put('*/api/service-types/:id', async ({ request, params }) => {
      const body = await request.json() as Schemas['ServiceTypeControllerRequest']
      bodies.push(body)
      list = list.map((s) => (String(s.id) === params.id ? { ...s, ...body } : s))
      return HttpResponse.json(list[0])
    }),
    http.post('*/api/service-types', async ({ request }) => {
      const body = await request.json() as Schemas['ServiceTypeControllerRequest']
      bodies.push(body)
      list = [...list, { id: 3, ...body }]
      return HttpResponse.json(list[2], { status: 201 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  expect(within(table).getByRole('columnheader', { name: 'Терапия' })).toBeInTheDocument()
  expect(within(table).getByRole('columnheader', { name: 'Другое' })).toBeInTheDocument()
  expect(within(table).getByText('от 2 500 сом')).toBeInTheDocument()
  expect(within(table).getByText('скрыта')).toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: 'Лечение кариеса' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  await user.clear(within(panel).getByRole('spinbutton', { name: 'Цена «от», сом' }))
  await user.type(within(panel).getByRole('spinbutton', { name: 'Цена «от», сом' }), '3000')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Сохранено')).toBeInTheDocument()
  expect(bodies[0]).toEqual({ name: 'Лечение кариеса', category: 'Терапия', durationMinutes: 60, active: true, priceSom: 3000 })

  await user.click(screen.getByRole('button', { name: '+ Добавить услугу' }))
  const fresh = await screen.findByRole('complementary', { name: 'Новая услуга' })
  await user.type(within(fresh).getByRole('textbox', { name: 'Название' }), 'Удаление зуба')
  await user.click(within(fresh).getByRole('button', { name: 'Хирургия' }))
  await user.click(within(fresh).getByRole('button', { name: 'Добавить' }))
  expect(await within(await screen.findByRole('table', { name: 'Услуги' })).findByRole('button', { name: 'Удаление зуба' })).toBeInTheDocument()
  expect(bodies[1]).toEqual({ name: 'Удаление зуба', category: 'Хирургия', durationMinutes: 30, active: true })
})

test('справочник: отметить типовые с ценой и добавить', async () => {
  let picked: unknown = null
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/service-types/catalog', () => HttpResponse.json([
      { category: 'Терапия', items: [{ name: 'Лечение кариеса', durationMinutes: 60, added: false }, { name: 'Пломба', durationMinutes: 45, added: true }] },
    ] satisfies Schemas['ServiceTypeServiceCatalogSection'][])),
    http.post('*/api/service-types/catalog', async ({ request }) => {
      picked = await request.json()
      return HttpResponse.json({ added: 1 } satisfies Schemas['ServiceTypeControllerAdded'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Из справочника' }))
  const panel = await screen.findByRole('complementary', { name: 'Справочник услуг' })
  await user.click(await within(panel).findByText('Терапия'))
  expect(within(panel).getByText('есть')).toBeInTheDocument()
  await user.click(within(panel).getByRole('checkbox', { name: /Лечение кариеса/ }))
  await user.type(within(panel).getByRole('spinbutton', { name: 'Цена: Лечение кариеса' }), '2000')
  await user.click(within(panel).getByRole('button', { name: 'Добавить выбранные (1)' }))
  expect(await within(panel).findByText('Добавлено услуг: 1')).toBeInTheDocument()
  expect(picked).toEqual({ items: [{ name: 'Лечение кариеса', priceSom: 2000 }] })
})

test('услуга: материалы по умолчанию — добавить со склада, поправить количество, убрать, сохранить', async () => {
  let saved: Schemas['ServiceSupplyControllerLines'] | null = null
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Лечение кариеса', durationMinutes: 60, category: 'Терапия', active: true },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.get('*/api/supplies', () => HttpResponse.json([
      { id: 3, name: 'Анестетик', unit: 'карп.', quantity: 5, minQuantity: 1, low: false },
      { id: 4, name: 'Композит', unit: 'шт', quantity: 2, minQuantity: 0, low: false },
      { id: 6, name: 'Перчатки', unit: 'уп', quantity: 3, minQuantity: 1, low: false },
    ] satisfies Schemas['SupplyView'][])),
    http.get('*/api/service-types/:id/supplies', () => HttpResponse.json([
      { supplyId: 6, name: 'Перчатки', unit: 'уп', quantity: 1, inStock: 3 },
    ] satisfies Schemas['ServiceSuppliesItem'][])),
    http.put('*/api/service-types/:id/supplies', async ({ request }) => {
      saved = await request.json() as Schemas['ServiceSupplyControllerLines']
      return HttpResponse.json((saved.items ?? []).map((i) => ({
        supplyId: i.supplyId, name: i.supplyId === 3 ? 'Анестетик' : 'Композит', unit: 'шт', quantity: i.quantity, inStock: 5,
      })) satisfies Schemas['ServiceSuppliesItem'][])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Лечение кариеса' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  const box = within(panel).getByRole('region', { name: 'Материалы по умолчанию' })
  expect(await within(box).findByText('Перчатки')).toBeInTheDocument()
  expect(within(box).queryByRole('button', { name: 'Сохранить материалы' })).not.toBeInTheDocument()

  await user.selectOptions(within(box).getByLabelText('Добавить материал'), 'Анестетик (карп.)')
  await user.click(within(box).getByRole('button', { name: 'Добавить' }))
  await user.selectOptions(within(box).getByLabelText('Добавить материал'), 'Композит (шт)')
  await user.click(within(box).getByRole('button', { name: 'Добавить' }))
  await user.clear(within(box).getByLabelText('Сколько: Анестетик'))
  await user.type(within(box).getByLabelText('Сколько: Анестетик'), '0')
  expect(within(box).getByRole('button', { name: 'Сохранить материалы' })).toBeDisabled()
  await user.clear(within(box).getByLabelText('Сколько: Анестетик'))
  await user.type(within(box).getByLabelText('Сколько: Анестетик'), '2')
  await user.click(within(box).getByRole('button', { name: 'Убрать: Перчатки' }))
  await user.click(within(box).getByRole('button', { name: 'Сохранить материалы' }))

  expect(await within(box).findByText('Сохранено')).toBeInTheDocument()
  expect(saved).toEqual({ items: [{ supplyId: 3, quantity: 2 }, { supplyId: 4, quantity: 1 }] })
})
