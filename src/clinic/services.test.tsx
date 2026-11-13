import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { groupServices, nameMatches } from './services'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

beforeEach(() => {
  window.location.hash = '/settings/services'
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
})
afterEach(() => {
  window.location.hash = ''
})

test('услуги по разделам: в порядке разделов, без раздела — «Другое», пустых групп нет', () => {
  const groups = groupServices<Schemas['ServiceTypeView']>([
    { id: 1, name: 'А', group: 'SURGERY', durationMinutes: 0, active: true }, { id: 2, name: 'Б', durationMinutes: 0, active: true }, { id: 3, name: 'В', group: 'EXAM', durationMinutes: 0, active: true },
    { id: 4, name: 'Г', group: 'THERAPY', durationMinutes: 0, active: true }, { id: 5, name: 'Д', group: 'SURGERY', durationMinutes: 0, active: true },
  ])
  expect(groups.map((g) => g.group)).toEqual(['EXAM', 'THERAPY', 'SURGERY', 'OTHER'])
  expect(groups[2]!.items.map((s) => s.id)).toEqual([1, 5])
})

test('поиск по названию: без регистра, «ё» = «е», слова в любом порядке', () => {
  expect(nameMatches('Осмотр ребёнка', 'РЕБЕНКА')).toBe(true)
  expect(nameMatches('Осмотр ребенка', 'ребён')).toBe(true)
  expect(nameMatches('Лечение кариеса', 'кариес леч')).toBe(true)
  expect(nameMatches('Лечение кариеса', 'пломба')).toBe(false)
  expect(nameMatches('Лечение кариеса', '  ')).toBe(true)
})

test('услуги: таблица по группам, правка и новая услуга', async () => {
  let list: Schemas['ServiceTypeView'][] = [
    { id: 1, name: 'Лечение кариеса', durationMinutes: 60, priceSom: 2500, category: 'Терапия', group: 'THERAPY', active: true },
    { id: 2, name: 'Консультация', durationMinutes: 30, active: false, group: 'OTHER' },
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
    http.get('*/api/service-types/group-guess', ({ request }) => HttpResponse.json({
      group: new URL(request.url).searchParams.get('name')?.startsWith('Удал') ? 'SURGERY' : 'OTHER',
    } satisfies Schemas['ServiceTypeControllerGroupGuess'])),
    http.post('*/api/service-types', async ({ request }) => {
      const body = await request.json() as Schemas['ServiceTypeControllerRequest']
      bodies.push(body)
      list = [...list, { id: 3, active: true, ...body, group: body.group ?? 'OTHER' }]
      return HttpResponse.json(list[2], { status: 201 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  expect(within(table).getByRole('columnheader', { name: 'Терапия · 1' })).toBeInTheDocument()
  expect(within(table).queryByRole('columnheader', { name: /Другое/ })).not.toBeInTheDocument()
  expect(within(table).getByText('от 2 500 сом')).toBeInTheDocument()
  // Скрытая — не в прайсе, а ниже, в «Ещё в справочнике клиники»
  expect(within(table).queryByText('Консультация')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Ещё в справочнике клиники: 1/ })).toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: 'Лечение кариеса' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  await user.clear(within(panel).getByRole('spinbutton', { name: 'Цена «от», сом' }))
  await user.type(within(panel).getByRole('spinbutton', { name: 'Цена «от», сом' }), '3000')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Услуга сохранена')).toBeInTheDocument()
  // Старую категорию не шлём — сервер её оставит; раздел — как был
  expect(bodies[0]).toEqual({ name: 'Лечение кариеса', group: 'THERAPY', durationMinutes: 60, active: true, priceSom: 3000 })

  await user.click(screen.getByRole('button', { name: '＋ Своя услуга' }))
  const fresh = await screen.findByRole('complementary', { name: 'Новая услуга' })
  await user.type(within(fresh).getByRole('textbox', { name: 'Название' }), 'Удаление зуба')
  // Раздел подобрал сервер по названию — подсказка и значение в списке
  expect(await within(fresh).findByText('Подобрали по названию — можно поменять')).toBeInTheDocument()
  expect(within(fresh).getByRole('combobox', { name: 'Раздел' })).toHaveTextContent('Хирургия')
  await user.click(within(fresh).getByRole('button', { name: 'Добавить' }))
  expect(await within(await screen.findByRole('table', { name: 'Услуги' })).findByRole('button', { name: 'Удаление зуба' })).toBeInTheDocument()
  expect(bodies[1]).toEqual({ name: 'Удаление зуба', group: 'SURGERY', durationMinutes: 30, active: true })
})

/** ≈ прайс клиники: 12 услуг в 5 разделах (вымышленные). */
const PRICE_LIST: Schemas['ServiceTypeView'][] = [
  ['Первичная консультация', 'EXAM'], ['Профессиональная чистка', 'HYGIENE'], ['Фторирование', 'HYGIENE'],
  ['Лечение кариеса', 'THERAPY'], ['Лечение пульпита, 1 канал', 'THERAPY'], ['Пломба светового отверждения', 'THERAPY'],
  ['Удаление зуба мудрости', 'SURGERY'], ['Удаление зуба простое', 'SURGERY'], ['Лечение молочного зуба', 'KIDS'],
  ['Осмотр ребёнка', 'KIDS'], ['Серебрение молочных зубов', 'KIDS'], ['Анестезия', 'OTHER'],
].map(([name, group], i) => ({ id: i + 1, name: name ?? '', group: group as Schemas['ServiceTypeView']['group'], durationMinutes: 30, active: true }))

test('«Услуги и цены»: поиск без регистра и «ё/е», чипы разделов с количеством, список по разделам', async () => {
  server.use(http.get('*/api/service-types', () => HttpResponse.json(PRICE_LIST)))
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  const chips = screen.getByRole('group', { name: 'Разделы' })
  expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Все · 12', 'Осмотр и консультация · 1', 'Профилактика и гигиена · 2', 'Терапия · 3', 'Хирургия · 2',
    'Детская стоматология · 3', 'Другое · 1',
  ])
  expect(within(table).getAllByRole('columnheader').slice(4).map((h) => h.textContent?.replace(/^[▾▸] /, ''))).toEqual([
    'Осмотр и консультация · 1', 'Профилактика и гигиена · 2', 'Терапия · 3', 'Хирургия · 2', 'Детская стоматология · 3', 'Другое · 1',
  ])

  // Чип — только этот раздел; ещё раз — все
  await user.click(within(chips).getByRole('button', { name: 'Хирургия · 2' }))
  expect(within(table).getAllByRole('row').slice(1).map((r) => r.textContent?.replace(/^[▾▸] /, ''))).toEqual([
    'Хирургия · 2', expect.stringContaining('Удаление зуба мудрости'), expect.stringContaining('Удаление зуба простое'),
  ])
  await user.click(within(chips).getByRole('button', { name: 'Хирургия · 2' }))
  expect(within(chips).getByRole('button', { name: 'Все · 12' })).toHaveAttribute('aria-pressed', 'true')

  // Поиск: «РЕБЕНКА» находит «Осмотр ребёнка»; счётчики — по найденному
  await user.type(screen.getByRole('searchbox', { name: 'Найти услугу' }), 'РЕБЕНКА')
  expect(within(screen.getByRole('table', { name: 'Услуги' })).getByRole('button', { name: 'Осмотр ребёнка' })).toBeInTheDocument()
  expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Все · 1', 'Детская стоматология · 1'])
  await user.clear(screen.getByRole('searchbox', { name: 'Найти услугу' }))
  await user.type(screen.getByRole('searchbox', { name: 'Найти услугу' }), 'молочн')
  await user.click(within(chips).getByRole('button', { name: 'Детская стоматология · 2' }))
  expect(within(screen.getByRole('table', { name: 'Услуги' })).getAllByRole('row')).toHaveLength(4)

  // Ничего — подсказка и «Показать все»
  await user.clear(screen.getByRole('searchbox', { name: 'Найти услугу' }))
  await user.type(screen.getByRole('searchbox', { name: 'Найти услугу' }), 'винир')
  expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Показать все' }))
  expect(within(await screen.findByRole('table', { name: 'Услуги' })).getAllByRole('button').filter((b) => !b.hasAttribute('aria-expanded'))).toHaveLength(12)
})

test('карточка услуги: раздел меняют в списке — уходит в запросе', async () => {
  let body: Schemas['ServiceTypeControllerRequest'] | null = null
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(PRICE_LIST)),
    http.put('*/api/service-types/:id', async ({ request }) => {
      body = await request.json() as Schemas['ServiceTypeControllerRequest']
      return HttpResponse.json({ ...PRICE_LIST[3], ...body })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Лечение кариеса' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  expect(within(panel).getByRole('combobox', { name: 'Раздел' })).toHaveTextContent('Терапия')
  await choose(within(panel).getByRole('combobox', { name: 'Раздел' }), 'Детская стоматология')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  await within(panel).findByText('Услуга сохранена')
  expect(body).toMatchObject({ name: 'Лечение кариеса', group: 'KIDS' })
})

test('справочник: отметить типовые с ценой и добавить', async () => {
  let picked: unknown = null
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/service-types/catalog', () => HttpResponse.json([
      { category: 'Терапия', items: [{ name: 'Лечение кариеса', durationMinutes: 60, added: false, typicalPriceSom: 2500 }, { name: 'Пломба', durationMinutes: 45, added: true }] },
    ] satisfies Schemas['ServiceTypeServiceCatalogSection'][])),
    http.post('*/api/service-types/catalog', async ({ request }) => {
      picked = await request.json()
      return HttpResponse.json({ added: 1 } satisfies Schemas['ServiceTypeControllerAdded'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Добавить услугу из справочника' }))
  const panel = await screen.findByRole('complementary', { name: 'Справочник услуг' })
  await user.click(await within(panel).findByText('Терапия'))
  expect(within(panel).getByText('есть')).toBeInTheDocument()
  await user.click(within(panel).getByRole('checkbox', { name: /Лечение кариеса/ }))
  // Обычная цена по Бишкеку уже в поле — поправляем
  expect(within(panel).getByRole('spinbutton', { name: 'Цена: Лечение кариеса' })).toHaveValue(2500)
  await user.clear(within(panel).getByRole('spinbutton', { name: 'Цена: Лечение кариеса' }))
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
        supplyId: i.supplyId ?? 0, name: i.supplyId === 3 ? 'Анестетик' : 'Композит', unit: 'шт', quantity: i.quantity ?? 1, inStock: 5,
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

  await choose(within(box).getByLabelText('Добавить материал'), 'Анестетик (карп.)')
  await user.click(within(box).getByRole('button', { name: 'Добавить' }))
  await choose(within(box).getByLabelText('Добавить материал'), 'Композит (шт)')
  await user.click(within(box).getByRole('button', { name: 'Добавить' }))
  await user.clear(within(box).getByLabelText('Сколько: Анестетик'))
  await user.type(within(box).getByLabelText('Сколько: Анестетик'), '0')
  expect(within(box).getByRole('button', { name: 'Сохранить материалы' })).toBeDisabled()
  await user.clear(within(box).getByLabelText('Сколько: Анестетик'))
  await user.type(within(box).getByLabelText('Сколько: Анестетик'), '2')
  await user.click(within(box).getByRole('button', { name: 'Убрать: Перчатки' }))
  await user.click(within(box).getByRole('button', { name: 'Сохранить материалы' }))

  expect(await within(box).findByText('Материалы сохранены')).toBeInTheDocument()
  expect(saved).toEqual({ items: [{ supplyId: 3, quantity: 2 }, { supplyId: 4, quantity: 1 }] })
})

test('«Заполнить по умолчанию»: что поставим, галочки и «Заполнить» — памятки и материалы', async () => {
  let memos: Schemas['CareMemosSuggested'][] = [{ serviceId: 7, service: 'Удаление зуба мудрости', memoId: 1, memo: 'После удаления зуба' }]
  let preview: Schemas['SupplyStarterPreview'] = {
    missing: [{ name: 'Маски', unit: 'шт' }],
    services: [{ id: 7, name: 'Удаление зуба мудрости', items: [{ name: 'Анестетик', unit: 'карп.', quantity: 2 }, { name: 'Маски', unit: 'шт', quantity: 1 }] }],
  }
  const sent: unknown[] = []
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 7, name: 'Удаление зуба мудрости', durationMinutes: 60, active: true }])),
    http.get('*/api/care-memos/starter', () => HttpResponse.json(memos)),
    http.get('*/api/supplies/starter', () => HttpResponse.json(preview)),
    http.post('*/api/care-memos/starter', () => {
      sent.push('memos')
      memos = []
      return HttpResponse.json({ services: 1 })
    }),
    http.post('*/api/supplies/starter', async ({ request }) => {
      sent.push(await request.json())
      preview = { missing: [], services: [] }
      return HttpResponse.json({ created: 1, services: 1 })
    }),
  )
  renderApp()
  const card = await screen.findByRole('region', { name: 'Стартовая настройка' })
  expect(card).toHaveTextContent('памятки (услуг: 1), что обычно уходит (услуг: 1), стандартные материалы на склад (1)')
  await userEvent.click(within(card).getByRole('button', { name: 'Посмотреть и заполнить' }))
  const panel = screen.getByRole('complementary', { name: 'Заполнить по умолчанию' })
  expect(within(panel).getByRole('region', { name: 'Памятки' })).toHaveTextContent('Удаление зуба мудрости → После удаления зуба')
  expect(within(panel).getByRole('region', { name: 'Материалы' })).toHaveTextContent('Анестетик 2 карп., Маски 1 шт')
  expect(panel).toHaveTextContent('Новые: Маски (шт).')
  await userEvent.click(within(panel).getByRole('button', { name: 'Заполнить' }))
  expect(await within(panel).findByRole('status')).toHaveTextContent(
    'Готово: памятки поставлены (услуг: 1), новых материалов на складе: 1, «что обычно уходит» задано (услуг: 1).')
  expect(sent).toEqual(['memos', { stock: true }])
  await userEvent.click(await within(panel).findByText('Закрыть', { selector: 'button' }))
  // Заполнили — плашки больше нет
  await waitForSlow(() => expect(screen.queryByRole('region', { name: 'Стартовая настройка' })).not.toBeInTheDocument())
})

test('«Заполнить по умолчанию»: админ видит недостающее из стандартного набора, снимает лишнее и добавляет', async () => {
  let kit: Schemas['ClinicStarterPreview'] = {
    services: [
      { name: 'Установка импланта', category: 'Имплантация', durationMinutes: 90, priceSom: 45000 },
      { name: 'Профессиональная чистка', category: 'Гигиена и отбеливание', durationMinutes: 60, priceSom: 3000, recallMonths: 6 },
      { name: 'Панорамный снимок (ОПТГ)', category: 'Диагностика', durationMinutes: 15 },
    ],
    memos: ['После установки или коррекции брекетов'],
    questions: ['Кормит грудью'],
    sources: ['WhatsApp'],
  }
  let sent: Schemas['StarterControllerRequest'] | null = null
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json([])),
    http.get('*/api/clinic/starter', () => HttpResponse.json(kit)),
    http.post('*/api/clinic/starter', async ({ request }) => {
      sent = await request.json() as Schemas['StarterControllerRequest']
      kit = { services: [], memos: [], questions: [], sources: [] }
      return HttpResponse.json({ services: 2, memos: 0, questions: 1, sources: 1 } satisfies Schemas['ClinicStarterApplied'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  // Услуг ещё нет — плашка всё равно есть: набор можно добавить сразу
  const card = await screen.findByRole('region', { name: 'Стартовая настройка' })
  expect(card).toHaveTextContent('типовые услуги (3), памятки, вопросы анкеты и «откуда узнали» (3)')
  await user.click(within(card).getByRole('button', { name: 'Посмотреть и заполнить' }))
  const panel = screen.getByRole('complementary', { name: 'Заполнить по умолчанию' })
  const services = within(panel).getByRole('region', { name: 'Типовые услуги' })
  expect(services).toHaveTextContent('Установка импланта · Имплантация · 90 мин · от 45 000 сом')
  expect(services).toHaveTextContent('Профессиональная чистка · Гигиена и отбеливание · 60 мин · от 3 000 сом · профосмотр через 6 мес.')
  expect(services).toHaveTextContent('Панорамный снимок (ОПТГ) · Диагностика · 15 мин · без цены')
  await user.click(within(services).getByRole('checkbox', { name: /Панорамный снимок/ }))
  expect(services).toHaveTextContent('Типовые услуги · 2 из 3')
  await user.click(within(panel).getByRole('checkbox', { name: /Новые памятки/ }))
  expect(within(panel).getByRole('region', { name: 'Вопросы анкеты' })).toHaveTextContent('Кормит грудью')
  expect(within(panel).getByRole('region', { name: 'Откуда узнали' })).toHaveTextContent('WhatsApp')

  await user.click(within(panel).getByRole('button', { name: 'Заполнить' }))
  expect(await within(panel).findByRole('status')).toHaveTextContent('Готово: услуг добавлено: 2, вопросов анкеты: 1, вариантов «откуда узнали»: 1')
  expect(sent).toEqual({ services: ['Установка импланта', 'Профессиональная чистка'], memos: false, questions: true, sources: true })
})

test('«Заполнить по умолчанию»: стандартный набор — только админу, врач его не запрашивает', async () => {
  let asked = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 7, name: 'Удаление зуба мудрости', durationMinutes: 60, active: true }])),
    http.get('*/api/care-memos/starter', () => HttpResponse.json([{ serviceId: 7, service: 'Удаление зуба мудрости', memoId: 1, memo: 'После удаления зуба' }])),
    http.get('*/api/clinic/starter', () => {
      asked = true
      return HttpResponse.json({ services: [], memos: [], questions: [], sources: [] })
    }),
  )
  renderApp()
  const card = await screen.findByRole('region', { name: 'Стартовая настройка' })
  expect(card).toHaveTextContent('памятки (услуг: 1)')
  expect(card).not.toHaveTextContent('типовые услуги')
  expect(asked).toBe(false)
})

test('«Профосмотр через»: свой срок услуги сохраняется, «Как в клинике» — поле не шлём', async () => {
  let list: Schemas['ServiceTypeView'][] = [
    { id: 1, name: 'Коррекция брекетов', durationMinutes: 30, category: 'Ортодонтия', active: true },
    { id: 2, name: 'Профессиональная чистка', durationMinutes: 60, category: 'Гигиена и отбеливание', active: true, recallMonths: 6 },
  ]
  const bodies: Schemas['ServiceTypeControllerRequest'][] = []
  server.use(
    http.get('*/api/clinic', () => HttpResponse.json({ recallMonths: 12 })),
    http.get('*/api/service-types', () => HttpResponse.json(list)),
    http.put('*/api/service-types/:id', async ({ request, params }) => {
      const body = await request.json() as Schemas['ServiceTypeControllerRequest']
      bodies.push(body)
      list = list.map((s) => (String(s.id) === params.id ? { ...s, ...body, recallMonths: body.recallMonths } : s))
      return HttpResponse.json(list.find((s) => String(s.id) === params.id))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  expect(within(table).getByText('через 6 мес.')).toBeInTheDocument()
  expect(within(table).getByText('как в клинике')).toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: 'Коррекция брекетов' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  const field = within(panel).getByRole('combobox', { name: 'Профосмотр через' })
  expect(await within(panel).findByText('Как в клинике (12 мес.)')).toBeInTheDocument()
  expect(within(panel).getByText('Через сколько месяцев после этой услуги позвать пациента снова')).toBeInTheDocument()
  await choose(field, '1 мес.')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Услуга сохранена')).toBeInTheDocument()
  expect(bodies[0]).toMatchObject({ name: 'Коррекция брекетов', recallMonths: 1 })
  expect(await within(table).findByText('через 1 мес.')).toBeInTheDocument()

  // Обратно «Как в клинике» — recallMonths не шлём, сервер ставит null
  await choose(field, 'Как в клинике (12 мес.)')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  await waitForSlow(() => expect(bodies).toHaveLength(2))
  expect(bodies[1]).not.toHaveProperty('recallMonths')
})

test('«Профосмотр по умолчанию»: админ меняет срок клиники', async () => {
  let months = 6
  const saved: unknown[] = []
  server.use(
    http.get('*/api/clinic', () => HttpResponse.json({ recallMonths: months })),
    http.get('*/api/service-types', () => HttpResponse.json([{ id: 1, name: 'Осмотр', durationMinutes: 30, active: true }])),
    http.put('*/api/clinic/recall-months', async ({ request }) => {
      const body = await request.json() as Schemas['ClinicControllerRecallRequest']
      saved.push(body)
      months = body.recallMonths!
      return HttpResponse.json({ recallMonths: months })
    }),
  )
  renderApp()
  const box = await screen.findByLabelText('Профосмотр по умолчанию', { selector: 'div' })
  expect(box).toHaveTextContent('Для приёмов без услуги и услуг без своего срока')
  const field = within(box).getByRole('combobox', { name: 'Профосмотр по умолчанию' })
  await waitForSlow(() => expect(field).toHaveTextContent('6 мес.'))
  await choose(field, '9 мес.')
  expect(await within(box).findByText('Срок сохранён')).toBeInTheDocument()
  expect(saved).toEqual([{ recallMonths: 9 }])
  await waitForSlow(() => expect(field).toHaveTextContent('9 мес.'))
})

test('«Профосмотр по умолчанию»: не админ только видит срок', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/clinic', () => HttpResponse.json({ recallMonths: 4 })),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
  renderApp()
  const box = await screen.findByLabelText('Профосмотр по умолчанию', { selector: 'div' })
  await waitForSlow(() => expect(box).toHaveTextContent('Профосмотр по умолчанию: через 4 мес.'))
  expect(within(box).queryByRole('combobox')).not.toBeInTheDocument()
})

test('«Услуги и цены»: раздел сворачивается и раскрывается нажатием на заголовок', async () => {
  server.use(http.get('*/api/service-types', () => HttpResponse.json(PRICE_LIST)))
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  const surgery = within(table).getByRole('button', { name: /Хирургия · 2/ })
  expect(surgery).toHaveAttribute('aria-expanded', 'true')
  expect(within(table).getByRole('button', { name: 'Удаление зуба простое' })).toBeInTheDocument()
  await user.click(surgery)
  expect(surgery).toHaveAttribute('aria-expanded', 'false')
  expect(within(table).queryByRole('button', { name: 'Удаление зуба простое' })).not.toBeInTheDocument()
  await user.click(surgery)
  expect(within(table).getByRole('button', { name: 'Удаление зуба простое' })).toBeInTheDocument()
})

test('«Объединить с…»: руководитель выбирает основную, подтверждает — дубль уходит из прайса', async () => {
  let list: Schemas['ServiceTypeView'][] = [
    { id: 1, name: 'Консультация', group: 'EXAM', durationMinutes: 30, priceSom: 500, active: true },
    { id: 2, name: 'Первичная консультация', group: 'EXAM', durationMinutes: 30, priceSom: 400, active: true },
    { id: 3, name: 'Профилактический осмотр', group: 'EXAM', durationMinutes: 20, active: false },
    { id: 4, name: 'Лечение кариеса', group: 'THERAPY', durationMinutes: 60, active: true },
  ]
  const merged: string[] = []
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(list)),
    http.post('*/api/service-types/:id/merge/:intoId', ({ params }) => {
      merged.push(`${String(params.id)}→${String(params.intoId)}`)
      list = list.filter((s) => String(s.id) !== params.id)
      return HttpResponse.json(list.find((s) => String(s.id) === params.intoId))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  await user.click(within(table).getByRole('button', { name: 'Первичная консультация' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  await user.click(within(panel).getByRole('button', { name: 'Объединить с…' }))
  const merge = within(panel).getByRole('group', { name: 'Объединить с другой услугой' })
  expect(within(merge).getByRole('button', { name: 'Объединить' })).toBeDisabled()
  // В списке — другие показываемые услуги: ни самой услуги, ни скрытой
  await user.click(within(merge).getByRole('combobox', { name: 'Основная услуга' }))
  const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
  expect(options.some((t) => t?.includes('Консультация'))).toBe(true)
  expect(options.some((t) => t?.includes('Первичная'))).toBe(false)
  expect(options.some((t) => t?.includes('Профилактический'))).toBe(false)
  await user.keyboard('{Escape}')
  await choose(within(merge).getByRole('combobox', { name: 'Основная услуга' }), 'Консультация')
  await user.click(within(merge).getByRole('button', { name: 'Объединить' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Все приёмы и записи «Первичная консультация» перейдут на «Консультация», «Первичная консультация» исчезнет из прайса. Отменить нельзя.')
  await user.click(within(dialog).getByRole('button', { name: 'Объединить' }))
  await waitForSlow(() => expect(screen.queryByRole('complementary', { name: 'Услуга' })).not.toBeInTheDocument())
  expect(merged).toEqual(['2→1'])
  expect(within(await screen.findByRole('table', { name: 'Услуги' })).queryByRole('button', { name: 'Первичная консультация' })).not.toBeInTheDocument()
})

test('«Объединить с…» — только руководителю: врач кнопки не видит', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Консультация', group: 'EXAM', durationMinutes: 30, active: true },
      { id: 2, name: 'Первичная консультация', group: 'EXAM', durationMinutes: 30, active: true },
    ] satisfies Schemas['ServiceTypeView'][])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Услуги' })).getByRole('button', { name: 'Первичная консультация' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  expect(within(panel).queryByRole('button', { name: 'Объединить с…' })).not.toBeInTheDocument()
})

test('«Ещё в справочнике клиники»: скрытые свёрнуты под прайсом, «Включить» возвращает в прайс', async () => {
  let list: Schemas['ServiceTypeView'][] = [
    { id: 1, name: 'Консультация', group: 'EXAM', durationMinutes: 30, priceSom: 500, active: true },
    { id: 2, name: 'Лечение кариеса', group: 'THERAPY', durationMinutes: 60, priceSom: 1500, active: true },
    { id: 3, name: 'Синус-лифтинг', group: 'IMPLANTS', durationMinutes: 120, priceSom: 30000, recallMonths: 6, active: false },
    { id: 4, name: 'Повторная консультация', group: 'EXAM', durationMinutes: 20, active: false },
  ]
  const bodies: unknown[] = []
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(list)),
    http.put('*/api/service-types/:id', async ({ request, params }) => {
      const body = await request.json() as Schemas['ServiceTypeControllerRequest']
      bodies.push(body)
      list = list.map((s) => (String(s.id) === params.id ? { ...s, ...body } : s))
      return HttpResponse.json(list.find((s) => String(s.id) === params.id))
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  expect(screen.getByText('В прайсе — основные услуги. Делаете что-то ещё — включите из справочника.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '＋ Добавить услугу из справочника' })).toBeInTheDocument()
  expect(within(table).queryByRole('button', { name: 'Синус-лифтинг' })).not.toBeInTheDocument()
  const block = screen.getByRole('region', { name: 'Ещё в справочнике клиники' })
  const head = within(block).getByRole('button', { name: /Ещё в справочнике клиники: 2 — включить, если делаете/ })
  expect(head).toHaveAttribute('aria-expanded', 'false')
  expect(within(block).queryByRole('button', { name: 'Включить: Синус-лифтинг' })).not.toBeInTheDocument()

  // Поиск находит и скрытую — блок раскрыт
  await user.type(screen.getByRole('searchbox', { name: 'Найти услугу' }), 'синус')
  expect(screen.getByText('В прайсе не нашли — есть ниже, в справочнике клиники.')).toBeInTheDocument()
  expect(within(block).getByRole('button', { name: 'Включить: Синус-лифтинг' })).toBeInTheDocument()
  await user.clear(screen.getByRole('searchbox', { name: 'Найти услугу' }))

  await user.click(head)
  expect(within(block).getByText(/120 мин · от 30 000 сом/)).toBeInTheDocument()
  await user.click(within(block).getByRole('button', { name: 'Включить: Синус-лифтинг' }))
  expect(await within(block).findByText('«Синус-лифтинг» — снова в прайсе')).toBeInTheDocument()
  // Остальное — как было: только active
  expect(bodies).toEqual([{ name: 'Синус-лифтинг', group: 'IMPLANTS', durationMinutes: 120, active: true, priceSom: 30000, recallMonths: 6 }])
  expect(await within(screen.getByRole('table', { name: 'Услуги' })).findByRole('button', { name: 'Синус-лифтинг' })).toBeInTheDocument()
  expect(within(block).getByRole('button', { name: /Ещё в справочнике клиники: 1/ })).toBeInTheDocument()
})

test('справочник: услуга уже есть у клиники, но не в прайсе — «Включить», а не вторая такая же', async () => {
  let list: Schemas['ServiceTypeView'][] = [{ id: 9, name: 'Синус-лифтинг', group: 'IMPLANTS', durationMinutes: 120, active: false }]
  let enabled: unknown = null
  server.use(
    http.get('*/api/service-types', () => HttpResponse.json(list)),
    http.get('*/api/service-types/catalog', () => HttpResponse.json([
      { category: 'Имплантация', items: [{ name: 'Синус-лифтинг', durationMinutes: 120, added: true, hiddenId: 9 }] },
    ] satisfies Schemas['ServiceTypeServiceCatalogSection'][])),
    http.put('*/api/service-types/:id', async ({ request }) => {
      enabled = await request.json()
      list = [{ ...list[0]!, active: true }]
      return HttpResponse.json(list[0])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Добавить услугу из справочника' }))
  const panel = await screen.findByRole('complementary', { name: 'Справочник услуг' })
  await user.click(await within(panel).findByText('Имплантация'))
  expect(within(panel).getByText('· не в прайсе')).toBeInTheDocument()
  await user.click(await within(panel).findByRole('button', { name: 'Включить: Синус-лифтинг' }))
  expect(await within(panel).findByText('«Синус-лифтинг» — снова в прайсе')).toBeInTheDocument()
  expect(enabled).toMatchObject({ name: 'Синус-лифтинг', active: true })
})

test('врач (не руководитель): прайс — только просмотр с подписью; в карточке услуги поля закрыты, материалы — его', async () => {
  let changed = false
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 1, name: 'Консультация', group: 'EXAM', durationMinutes: 30, active: true, priceSom: 500 },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.put('*/api/service-types/:id', () => {
      changed = true
      return HttpResponse.json({ id: 1 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Услуги' })
  expect(screen.getByText(/Цены общие для клиники; в карточке врача — какие услуги он делает/)).toBeInTheDocument()
  expect(screen.getAllByText(/Цены и часы клиники меняет руководитель/).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: '＋ Своя услуга' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '＋ Добавить услугу из справочника' })).not.toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Консультация' }))
  const panel = await screen.findByRole('complementary', { name: 'Услуга' })
  expect(within(panel).getByRole('textbox', { name: 'Название' })).toBeDisabled()
  expect(within(panel).getByRole('spinbutton', { name: /Цена/ })).toBeDisabled()
  expect(within(panel).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  expect(changed).toBe(false)
})
