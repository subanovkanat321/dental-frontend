import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, openPlatform } from '../test/fixtures'
import { choose } from '../test/select'
import { server } from '../test/server'

type Lead = Schemas['SalesFunnelLead']

/** Вымышленные клиники — настоящих в тестах не бывает. Номера 99655510xxxx — тоже выдуманные. */
function lead(id: number, extra: Partial<Lead> = {}): Lead {
  return {
    id, clinicName: `Клиника ${String(id).padStart(3, '0')}`, phone: `996555${String(100000 + id)}`, city: 'Бишкек',
    address: `ул. Вымышленная, ${id}`, stage: 'LEAD', source: 'LIST', solo: false,
    createdAt: '2026-11-08T05:00:00Z', stageAt: '2026-11-08T05:00:00Z', ...extra,
  }
}

function outreach(leads: Lead[]): Schemas['ClinicOutreachOutreach'] {
  const n = (stages: string[]) => leads.filter((l) => stages.includes(l.stage!)).length
  return {
    counts: { fresh: n(['LEAD']), sent: n(['CONTACTED']), further: n(['DEMO', 'TRIAL', 'PAYING']), declined: n(['LOST']) },
    leads, template: { text: 'Здравствуйте, {клиника}!', custom: false, defaultText: 'Здравствуйте, {клиника}!', videoText: 'Ролик', reminderText: 'Напоминаю', remindAfterDays: 3, signupUrl: 'https://tish.test/start' },
  }
}

/** 30 клиник: в начале — особенные (Ош, «Написали» в разные дни, 2ГИС), остальные — «Клиника NNN». */
function thirty(): Lead[] {
  return [
    lead(1, { clinicName: 'Ясный зуб', contactedAt: '2026-11-03T08:00:00Z', stage: 'CONTACTED', link: 'https://2gis.kg/bishkek/firm/1' }),
    lead(2, { clinicName: 'Альфа-Дент', city: 'Ош', address: 'пр. Тестовый, 77' }),
    lead(3, { clinicName: 'Бета-Смайл', contactedAt: '2026-11-10T08:00:00Z', stage: 'CONTACTED', remindedAt: '2026-11-13T08:00:00Z' }),
    ...Array.from({ length: 27 }, (_, i) => lead(i + 4)),
  ]
}

let leads: Lead[]

beforeEach(() => {
  localStorage.removeItem('tish.outreach.view')
  window.location.hash = '/platform'
  leads = thirty()
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true, platform: true })),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/funnel', () => HttpResponse.json({ total: 0, stages: [], leads: [] })),
    http.get('*/api/platform/outreach', () => HttpResponse.json(outreach(leads))),
  )
})
afterEach(() => {
  localStorage.removeItem('tish.outreach.view')
  window.location.hash = ''
  vi.restoreAllMocks()
})

async function openTab() {
  const user = userEvent.setup()
  const view = renderApp()
  await openPlatform('Рассылка клиникам', 'По одной (WhatsApp и Instagram)', user)
  await screen.findByRole('heading', { name: 'Клиники' })
  return { user, view }
}

/** Названия клиник в строках таблицы — сверху вниз. */
function names(): string[] {
  const table = screen.getByRole('table', { name: 'Клиники таблицей' })
  return within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent ?? '')
}

test('больше 20 клиник на компьютере — таблицей; выбор «Список» запоминается на устройстве', async () => {
  const { user, view } = await openTab()
  const table = await screen.findByRole('table', { name: 'Клиники таблицей' })
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent))
    .toEqual(['№ ↑', 'Название', 'Телефон', 'Instagram', 'Канал', 'Адрес', 'Город', 'Статус', 'Написали', 'Напомнили', 'Ссылка'])
  const first = within(table).getAllByRole('row')[1]!
  expect(first).toHaveTextContent('Ясный зуб')
  expect(first).toHaveTextContent('Написали 3 нояб 2026')
  const link = within(first).getByRole('link', { name: '2ГИС: Ясный зуб' })
  expect(link).toHaveAttribute('href', 'https://2gis.kg/bishkek/firm/1')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link.getAttribute('rel')).toContain('noopener')

  const views = screen.getByRole('group', { name: 'Вид' })
  expect(within(views).getByRole('button', { name: 'Таблица' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(views).getByRole('button', { name: 'Список' }))
  expect(screen.getByRole('list', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: 'Клиники таблицей' })).not.toBeInTheDocument()
  expect(localStorage.getItem('tish.outreach.view')).toBe('list')

  // Открыли снова — список, как выбрали
  view.unmount()
  await openTab()
  expect(await screen.findByRole('list', { name: 'Клиники' })).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: 'Клиники таблицей' })).not.toBeInTheDocument()
})

test('мало клиник — список; «Таблица» по кнопке', async () => {
  leads = leads.slice(0, 5)
  const { user } = await openTab()
  expect(await screen.findByRole('list', { name: 'Клиники' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Таблица' }))
  expect(names()).toHaveLength(5)
  expect(localStorage.getItem('tish.outreach.view')).toBe('table')
})

test('сортировка по заголовку: название ↑/↓, «Написали» — сначала новые; aria-sort', async () => {
  const { user } = await openTab()
  await screen.findByRole('table', { name: 'Клиники таблицей' })
  expect(names().slice(0, 3)).toEqual(['Ясный зуб', 'Альфа-Дент', 'Бета-Смайл'])

  const header = (name: string) => screen.getAllByRole('columnheader').find((th) => th.textContent?.startsWith(name))!
  await user.click(within(header('Название')).getByRole('button'))
  expect(header('Название')).toHaveAttribute('aria-sort', 'ascending')
  expect(names()[0]).toBe('Альфа-Дент')
  expect(names()[1]).toBe('Бета-Смайл')
  await user.click(within(header('Название')).getByRole('button'))
  expect(header('Название')).toHaveAttribute('aria-sort', 'descending')
  expect(names()[0]).toBe('Ясный зуб')

  await user.click(within(header('Написали')).getByRole('button'))
  expect(header('Написали')).toHaveAttribute('aria-sort', 'descending')
  expect(header('Название')).toHaveAttribute('aria-sort', 'none')
  // Сначала новые, пустые — в конце
  expect(names().slice(0, 2)).toEqual(['Бета-Смайл', 'Ясный зуб'])
  await user.click(within(header('Написали')).getByRole('button'))
  expect(names().slice(0, 2)).toEqual(['Ясный зуб', 'Бета-Смайл'])
})

test('поиск по адресу и телефону, фильтр по городу', async () => {
  const { user } = await openTab()
  await screen.findByRole('table', { name: 'Клиники таблицей' })
  const search = screen.getByRole('searchbox', { name: 'Поиск: название, адрес, телефон, Instagram' })
  await user.type(search, 'Тестовый')
  expect(names()).toEqual(['Альфа-Дент'])
  await user.clear(search)
  // Телефон — по цифрам, с пробелами как набрали
  await user.type(search, '100 003')
  expect(names()).toEqual(['Бета-Смайл'])
  await user.clear(search)
  expect(names()).toHaveLength(30)

  await choose(screen.getByRole('combobox', { name: 'Город' }), 'Ош')
  expect(names()).toEqual(['Альфа-Дент'])
  await choose(screen.getByRole('combobox', { name: 'Город' }), 'Все города')
  expect(names()).toHaveLength(30)
})

test('один город — фильтра по городу нет', async () => {
  leads = leads.map((l) => ({ ...l, city: 'Бишкек' }))
  await openTab()
  await screen.findByRole('table', { name: 'Клиники таблицей' })
  expect(screen.queryByRole('combobox', { name: 'Город' })).not.toBeInTheDocument()
})

test('нажатие на строку открывает карточку клиники справа с теми же действиями; ✕ закрывает', async () => {
  const { user } = await openTab()
  const table = await screen.findByRole('table', { name: 'Клиники таблицей' })
  const row = within(table).getAllByRole('row').find((r) => r.textContent?.includes('Альфа-Дент'))!
  await user.click(within(row).getByText('пр. Тестовый, 77'))
  const panel = screen.getByRole('complementary', { name: 'Клиника: Альфа-Дент' })
  expect(within(panel).getByRole('heading', { name: 'Альфа-Дент' })).toBeInTheDocument()
  expect(within(panel).getByText('Не писали')).toBeInTheDocument()
  expect(within(panel).getByLabelText('Текст сообщения')).toHaveTextContent('Здравствуйте, Альфа-Дент!')
  expect(within(panel).getByRole('button', { name: '📨 Отправить сообщение' })).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Ещё: Альфа-Дент' }))
  expect(screen.getByRole('menuitem', { name: 'Не беспокоить' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(row).toHaveClass('active')

  // Отметили «Отправили» — запрос тот же, что в списке
  const sent: number[] = []
  server.use(http.post('*/api/platform/outreach/:id/sent', ({ params }) => {
    sent.push(Number(params.id))
    return HttpResponse.json(lead(2, { stage: 'CONTACTED' }))
  }))
  vi.spyOn(window, 'open').mockImplementation(() => null)
  const open = screen.getByRole('complementary', { name: 'Клиника: Альфа-Дент' })
  await user.click(within(open).getByRole('button', { name: '📨 Отправить сообщение' }))
  await user.click(within(open).getByRole('button', { name: 'Да' }))
  await waitFor(() => expect(sent).toEqual([2]))

  await user.click(within(screen.getByRole('complementary', { name: 'Клиника: Альфа-Дент' })).getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('complementary', { name: /^Клиника:/ })).not.toBeInTheDocument()
})

test('сотни клиник — по 100 строк и «Показать ещё»; кнопка «Скачать в Excel»', async () => {
  leads = Array.from({ length: 250 }, (_, i) => lead(i + 1))
  const asked: string[] = []
  server.use(http.get('*/api/platform/outreach/export', ({ request }) => {
    asked.push(new URL(request.url).search)
    return new HttpResponse('x', { headers: { 'Content-Type': 'application/octet-stream' } })
  }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  if (!('createObjectURL' in URL)) Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  const { user } = await openTab()
  await screen.findByRole('table', { name: 'Клиники таблицей' })
  expect(names()).toHaveLength(100)
  await user.click(screen.getByRole('button', { name: 'Показать ещё 100 (осталось 150)' }))
  expect(names()).toHaveLength(200)
  await user.click(screen.getByRole('button', { name: 'Показать ещё 50 (осталось 50)' }))
  expect(names()).toHaveLength(250)
  expect(screen.queryByRole('button', { name: /^Показать ещё/ })).not.toBeInTheDocument()
  // Сменили фильтр — снова первые 100
  await user.type(screen.getByRole('searchbox', { name: 'Поиск: название, адрес, телефон, Instagram' }), 'Клиника')
  expect(names()).toHaveLength(100)

  await user.click(screen.getByRole('button', { name: 'Скачать в Excel' }))
  await waitFor(() => expect(asked).toEqual(['?format=xlsx']))
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
})

test('колонки «Instagram» и «Канал», фильтр канала и поиск по логину; «Написали» — с каналом', async () => {
  leads = leads.map((l) => l.id === 2 ? { ...l, instagram: 'alfa.dent' }
    : l.id === 4 ? { ...l, phone: undefined, instagram: 'only_insta' }
      : l.id === 3 ? { ...l, contactedVia: 'INSTAGRAM' } : l)
  const { user } = await openTab()
  const table = await screen.findByRole('table', { name: 'Клиники таблицей' })
  expect(within(table).getByRole('columnheader', { name: /Канал/ })).toBeInTheDocument()
  const alfa = within(table).getByRole('link', { name: '@alfa.dent' })
  expect(alfa).toHaveAttribute('href', 'https://www.instagram.com/alfa.dent/')
  const row = (name: string) => within(table).getByRole('button', { name }).closest('tr')!
  expect(row('Альфа-Дент')).toHaveTextContent('WhatsApp + Instagram')
  expect(row('Бета-Смайл')).toHaveTextContent('10 нояб 2026 Instagram')
  expect(row('Ясный зуб')).toHaveTextContent('3 нояб 2026 WhatsApp')

  await choose(screen.getByRole('combobox', { name: 'Канал' }), 'Instagram')
  expect(names()).toEqual(['Альфа-Дент', 'Клиника 004'])
  await choose(screen.getByRole('combobox', { name: 'Канал' }), 'Есть оба')
  expect(names()).toEqual(['Альфа-Дент'])
  await choose(screen.getByRole('combobox', { name: 'Канал' }), 'WhatsApp')
  expect(names()).toHaveLength(29)
  await choose(screen.getByRole('combobox', { name: 'Канал' }), 'Все каналы')

  await user.type(screen.getByRole('searchbox', { name: 'Поиск: название, адрес, телефон, Instagram' }), '@only_in')
  expect(names()).toEqual(['Клиника 004'])
})

test('без Instagram у клиник — фильтра «Канал» нет', async () => {
  await openTab()
  await screen.findByRole('table', { name: 'Клиники таблицей' })
  expect(screen.queryByRole('combobox', { name: 'Канал' })).not.toBeInTheDocument()
})
