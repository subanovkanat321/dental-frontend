import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { cityChips, nameMatches, NONE } from './clinicFilter'

// «Платформа → Клиники»: сверху «＋ Создать клинику», ниже фильтр по городам и статусу. Клиники вымышленные.

const owner = { ...me, owner: true, platform: true }
const manager = { ...me, owner: false, platform: true, admin: false }
const clinic = (id: number, name: string, extra: Partial<Schemas['PlatformServiceClinicRow']> = {}) => ({
  id, name, code: `c${id}`, doctors: 1, staff: 1, patients: 3, appointments: 4, done30: 3, noShow30: 0, health: 'OK', billing: { state: 'FREE' },
  bookedWeek: 0, selfBooked30: 0, unmarked: 0, hidden: false, listed: true, settingUp: false, ...extra,
}) satisfies Schemas['PlatformServiceClinicRow']

const CLINICS = [
  clinic(1, 'Тиш Дент', { city: 'Бишкек' }),
  clinic(2, 'Улыбка', { city: 'Бишкек', health: 'ASLEEP' }),
  clinic(3, 'Ак-Тиш', { city: 'Ош' }),
  clinic(4, 'Жемчуг'),
  clinic(5, 'Тестовая', { city: 'Ош', hidden: true }),
]

function backend(clinics = CLINICS, who: object = owner) {
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/platform/clinics', () => HttpResponse.json(clinics)),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/clinics/:id/agreement', () => HttpResponse.json({ scans: [] })),
    http.get('*/api/platform/clinics/:id/plan', () => HttpResponse.json({ billing: { state: 'FREE' }, doctors: 1, payments: [] })),
  )
}

beforeEach(() => {
  window.location.hash = '/platform'
  localStorage.clear()
})
afterEach(() => {
  window.location.hash = ''
})

test('города с количеством: больше клиник — выше, «Без города» — последним; поиск без регистра и «ё»', () => {
  expect(cityChips(['Ош', 'Бишкек', null, 'Бишкек', ''], '*')).toEqual([['Бишкек', 'Бишкек', 2], ['Ош', 'Ош', 1], [NONE, 'Без города', 2]])
  // Выбранный город пропал из списка — чип с нулём, чтобы снять выбор
  expect(cityChips(['Ош'], 'Нарын')).toEqual([['Ош', 'Ош', 1], ['Нарын', 'Нарын', 0]])
  expect(nameMatches('Жёлтая Улыбка', 'желтая')).toBe(true)
  expect(nameMatches('Улыбка', 'тиш')).toBe(false)
})

test('«＋ Создать клинику» — первым, над списком клиник', async () => {
  backend()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Клиники' })
  const create = screen.getByRole('button', { name: '＋ Создать клинику' })
  // Кнопка идёт в разметке раньше фильтра и таблицы
  expect(create.compareDocumentPosition(screen.getByRole('group', { name: 'Города' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(create.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('фильтр по городу, «Все», статус и поиск; выбор города помнится', async () => {
  backend()
  const user = userEvent.setup()
  const { unmount } = renderApp()
  const cities = await screen.findByRole('group', { name: 'Города' })
  // Скрытые клиники в счётчиках не участвуют
  expect(within(cities).getByRole('button', { name: 'Все · 4' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(cities).getByRole('button', { name: 'Бишкек · 2' })).toBeInTheDocument()
  expect(within(cities).getByRole('button', { name: 'Ош · 1' })).toBeInTheDocument()
  expect(within(cities).getByRole('button', { name: 'Без города · 1' })).toBeInTheDocument()
  const names = () => within(screen.getByRole('table', { name: 'Клиники' })).getAllByRole('button').map((b) => b.textContent?.replace(' ›', ''))
  expect(names()[0]).toBe('Улыбка') // уснувшая — первой
  expect(names().sort()).toEqual(['Ак-Тиш', 'Жемчуг', 'Тиш Дент', 'Улыбка'])

  await user.click(within(cities).getByRole('button', { name: 'Бишкек · 2' }))
  expect(names()).toEqual(['Улыбка', 'Тиш Дент'])
  // Статус — тоже фильтр: «Позвонить» — уснувшие этого города
  const status = screen.getByRole('group', { name: 'Статус' })
  await user.click(within(status).getByRole('button', { name: /^позвонить: 1/ }))
  expect(names()).toEqual(['Улыбка'])
  await user.click(within(status).getByRole('button', { name: /^позвонить: 1/ }))

  await user.type(screen.getByRole('searchbox', { name: 'Найти клинику' }), 'тиш')
  expect(names()).toEqual(['Тиш Дент'])
  await user.clear(screen.getByRole('searchbox', { name: 'Найти клинику' }))

  await user.click(within(cities).getByRole('button', { name: 'Без города · 1' }))
  expect(names()).toEqual(['Жемчуг'])

  // Открыли раздел снова — город тот же
  unmount()
  renderApp()
  expect(await screen.findByRole('button', { name: 'Без города · 1' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Все · 4' }))
  expect(names()).toHaveLength(4)
})

test('строка кликабельна — карточка клиники', async () => {
  backend()
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Клиники' })
  await user.click(within(table).getByText('Ак-Тиш').closest('tr')!.querySelector('td.r')!)
  expect(await screen.findByRole('complementary', { name: 'Клиника на платформе' })).toHaveTextContent('Ак-Тиш')
})

test('создать клинику: руководитель по номеру и оплата — форма отправляет всё одним запросом', async () => {
  backend([])
  const sent: unknown[] = []
  server.use(http.post('*/api/platform/clinics', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json({ id: 9, clinic: clinic(9, 'Стоматология Тест', { admins: 'Айбек Осмонов' }), adminPhone: '+996700770001' } satisfies Schemas['PlatformServiceCreated'], { status: 201 })
  }))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Создать клинику' }, { timeout: 10000 }))
  const form = await screen.findByRole('form', { name: 'Создать клинику' })
  await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Стоматология Тест')
  await user.click(within(form).getByRole('combobox', { name: /Город/ }))
  await user.click(await screen.findByRole('option', { name: 'Ош' }))
  await user.type(within(form).getByRole('textbox', { name: 'Телефон клиники' }), '555123456')
  await user.click(within(form).getByRole('button', { name: 'Вход по номеру' }))
  await user.type(within(form).getByRole('textbox', { name: 'Имя руководителя' }), 'Айбек Осмонов')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон руководителя' }), '700770001')
  await user.click(within(form).getByRole('button', { name: 'Создать клинику' }))

  await waitForSlow(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({ name: 'Стоматология Тест', city: 'Ош', adminAccess: 'PHONE', adminName: 'Айбек Осмонов', alsoDoctor: false })
  expect((sent[0] as { phone: string }).phone.replace(/\D/g, '')).toBe('996555123456')
  expect((sent[0] as { adminPhone: string }).adminPhone.replace(/\D/g, '')).toBe('996700770001')
  // Пилот — без срока оплаты
  expect(sent[0]).not.toHaveProperty('paidUntil')
  const done = await screen.findByRole('complementary', { name: 'Клиника создана' })
  expect(within(done).getByRole('status')).toHaveTextContent('входит на сайте по номеру')
})

test('создать клинику ссылкой: ответ — ссылка руководителю; менеджеру «по номеру» и оплату не показываем', async () => {
  backend([], manager)
  const sent: unknown[] = []
  server.use(http.post('*/api/platform/clinics', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json({ id: 9, clinic: clinic(9, 'Улыбка Ош'), invite: { token: 'tok1' } } satisfies Schemas['PlatformServiceCreated'], { status: 201 })
  }))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: '＋ Создать клинику' }, { timeout: 10000 }))
  const form = await screen.findByRole('form', { name: 'Создать клинику' })
  expect(within(form).queryByRole('button', { name: 'Вход по номеру' })).not.toBeInTheDocument()
  expect(within(form).queryByRole('group', { name: 'Оплата' })).not.toBeInTheDocument()
  await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Улыбка Ош')
  await user.type(within(form).getByRole('textbox', { name: 'Имя руководителя' }), 'Айгуль')
  await user.click(within(form).getByRole('button', { name: 'Создать клинику' }))

  await waitForSlow(() => expect(sent).toEqual([{ name: 'Улыбка Ош', adminAccess: 'LINK', adminName: 'Айгуль', alsoDoctor: false }]))
  const done = await screen.findByRole('complementary', { name: 'Клиника создана' })
  expect(await within(done).findByText(/staff_tok1/)).toBeInTheDocument()
})
