import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { messageFor, nextLead } from './outreach'

type Lead = Schemas['SalesFunnelLead']

/** Вымышленные клиники — настоящих в тестах не бывает. */
function lead(id: number, clinicName: string, extra: Partial<Lead> = {}): Lead {
  return {
    id, clinicName, phone: `99655500040${id}`, city: 'Бишкек', stage: 'LEAD', source: 'LIST',
    createdAt: '2026-11-08T05:00:00Z', stageAt: '2026-11-08T05:00:00Z', ...extra,
  }
}

const TEMPLATE = 'Здравствуйте, {клиника}! 😊\nМы — Tish. Подробнее: tish.kg/about'
const owner = { ...me, owner: true, platform: true }

function outreach(leads: Lead[]): Schemas['ClinicOutreachOutreach'] {
  const n = (stages: string[]) => leads.filter((l) => stages.includes(l.stage!)).length
  return {
    counts: { fresh: n(['LEAD']), sent: n(['CONTACTED']), further: n(['DEMO', 'TRIAL', 'PAYING']), declined: n(['LOST']) },
    leads, template: { text: TEMPLATE, custom: false, defaultText: TEMPLATE },
  }
}

let leads: Lead[]

beforeEach(() => {
  window.location.hash = '/platform'
  leads = [
    lead(1, 'Тест-Улыбка', { stage: 'CONTACTED', contactedAt: '2026-11-07T08:00:00Z' }),
    lead(2, 'Тест-Дент', { address: 'ул. Вымышленная, 2' }),
    lead(3, 'Тест-Отказ', { stage: 'LOST', lostReason: 'Уже есть программа' }),
    lead(4, 'Тест-Ёлка'),
    lead(5, 'Тест-Демо', { stage: 'DEMO' }),
  ]
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json(owner)),
    http.get('*/api/platform/clinics', () => HttpResponse.json([])),
    http.get('*/api/platform/applications', () => HttpResponse.json([])),
    http.get('*/api/platform/agreements/statuses', () => HttpResponse.json({})),
    http.get('*/api/platform/pay-requests', () => HttpResponse.json([])),
    http.get('*/api/platform/funnel', () => HttpResponse.json({ total: 0, stages: [], leads: [] })),
    http.get('*/api/platform/outreach', () => HttpResponse.json(outreach(leads))),
  )
})
afterEach(() => {
  window.location.hash = ''
  vi.restoreAllMocks()
})

async function openTab() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'Написать клиникам' }))
  await screen.findByRole('list', { name: 'Клиники' })
  return user
}

test('текст с названием клиники и «Следующая клиника» — по порядку, мимо написанных и отказавшихся', () => {
  expect(messageFor('Привет, {клиника}! {клиника}', 'Тест')).toBe('Привет, Тест! Тест')
  const list = [lead(1, 'А', { stage: 'CONTACTED' }), lead(2, 'Б'), lead(3, 'В', { stage: 'LOST' }), lead(4, 'Г'), lead(5, 'Д', { phone: undefined })]
  expect(nextLead(list, null)?.id).toBe(2)
  expect(nextLead(list, 2)?.id).toBe(4)
  // С конца — снова сначала; без телефона и ссылки — пропускаем
  expect(nextLead(list, 4)?.id).toBe(2)
  // Текущую уже отметили и она ушла из списка — первая неписаная
  expect(nextLead(list.filter((l) => l.id !== 2), 2)?.id).toBe(4)
  expect(nextLead([lead(1, 'А', { stage: 'CONTACTED' })], null)).toBeNull()
})

test('WhatsApp открывает wa.me с номером и текстом, «Отправили? — Да» ставит отметку', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  let marked: string | null = null
  server.use(http.post('*/api/platform/outreach/:id/sent', ({ params }) => {
    marked = String(params.id)
    leads = leads.map((l) => l.id === 2 ? { ...l, stage: 'CONTACTED', contactedAt: '2026-11-08T06:00:00Z' } : l)
    return HttpResponse.json(leads.find((l) => l.id === 2)!)
  }))
  const user = await openTab()

  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  await user.click(within(card).getByRole('button', { name: 'Написать в WhatsApp' }))
  const text = 'Здравствуйте, Тест-Дент! 😊\nМы — Tish. Подробнее: https://tish.kg/about'
  expect(open).toHaveBeenCalledWith(`https://wa.me/996555000402?text=${encodeURIComponent(text)}`, '_blank', 'noopener')

  const ask = within(card).getByRole('group', { name: 'Отправили?' })
  // «Нет» — ничего не отмечаем
  await user.click(within(ask).getByRole('button', { name: 'Нет' }))
  expect(marked).toBeNull()
  expect(within(card).queryByRole('group', { name: 'Отправили?' })).not.toBeInTheDocument()

  await user.click(within(card).getByRole('button', { name: 'Скопировать текст' }))
  expect(await navigator.clipboard.readText()).toBe(text)
  await user.click(within(within(card).getByRole('group', { name: 'Отправили?' })).getByRole('button', { name: 'Да' }))
  await waitFor(() => expect(marked).toBe('2'))
  expect(await within(screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })).findByText(/^Написали/)).toBeInTheDocument()

  // Просили не беспокоить — кнопки WhatsApp нет, причина видна
  const lost = screen.getByRole('listitem', { name: 'Клиника: Тест-Отказ' })
  expect(within(lost).queryByRole('button', { name: 'Написать в WhatsApp' })).not.toBeInTheDocument()
  expect(within(lost).getByText(/Просили не беспокоить: Уже есть программа/)).toBeInTheDocument()
})

test('счётчики, фильтры, поиск и «Следующая клиника»', async () => {
  const user = await openTab()
  const groups = screen.getByRole('group', { name: 'Кому писали' })
  expect(within(groups).getByRole('button', { name: 'Все · 5' })).toBeInTheDocument()
  expect(within(groups).getByRole('button', { name: 'Не писали · 2' })).toBeInTheDocument()
  expect(within(groups).getByRole('button', { name: 'Написали · 1' })).toBeInTheDocument()
  expect(within(groups).getByRole('button', { name: 'Ответили/дальше · 1' })).toBeInTheDocument()
  expect(within(groups).getByRole('button', { name: 'Отказались · 1' })).toBeInTheDocument()

  await user.click(within(groups).getByRole('button', { name: 'Отказались · 1' }))
  expect(within(screen.getByRole('list', { name: 'Клиники' })).getAllByRole('listitem').map((x) => x.getAttribute('aria-label')))
    .toEqual(['Клиника: Тест-Отказ'])
  await user.click(within(groups).getByRole('button', { name: 'Все · 5' }))
  await user.type(screen.getByRole('searchbox', { name: 'Поиск по названию' }), 'елка')
  expect(within(screen.getByRole('list', { name: 'Клиники' })).getAllByRole('listitem')).toHaveLength(1)

  // «Следующая клиника» — первая неписаная: поиск сбрасывается, карточка открывается с текстом
  await user.click(screen.getByRole('button', { name: 'Следующая клиника →' }))
  const first = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  expect(first).toHaveAttribute('aria-current', 'true')
  expect(within(first).getByLabelText('Текст сообщения')).toHaveTextContent('Здравствуйте, Тест-Дент!')
  await user.click(screen.getByRole('button', { name: 'Следующая клиника →' }))
  expect(screen.getByRole('listitem', { name: 'Клиника: Тест-Ёлка' })).toHaveAttribute('aria-current', 'true')
})

test('загрузка списка: вставка → предпросмотр с дублями и ошибками → добавить', async () => {
  const sent: { url: string; text: string | null; city: string | null }[] = []
  const report = (added: number): Schemas['ClinicOutreachImportReport'] => ({
    total: 3, fresh: 1, duplicates: 1, errors: 1, added,
    rows: [
      { line: 1, clinicName: 'Новая-Тест', phone: '996555000411', city: 'Бишкек', status: 'NEW' },
      { line: 2, clinicName: 'Тест-Дент', phone: '996555000402', city: 'Бишкек', status: 'DUPLICATE', message: 'Уже в воронке: «Тест-Дент» — тот же телефон' },
      { line: 3, clinicName: 'Без контактов', city: 'Бишкек', status: 'ERROR', message: 'Нужен телефон или ссылка — иначе как написать?' },
    ],
  })
  // Форма отправляет переводы строк как \r\n — сервер понимает оба
  const handle = (added: number) => async ({ request }: { request: Request }) => {
    const form = await request.formData()
    sent.push({ url: new URL(request.url).pathname, text: (form.get('text') as string | null)?.replace(/\r\n/g, '\n') ?? null, city: form.get('city') as string | null })
    return HttpResponse.json(report(added))
  }
  server.use(
    http.post('*/api/platform/outreach/import/preview', handle(0)),
    http.post('*/api/platform/outreach/import', handle(1)),
  )
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: 'Загрузить список клиник' }))
  const box = screen.getByRole('group', { name: 'Загрузить список клиник' })
  await user.type(within(box).getByRole('textbox', { name: 'Список' }), 'Новая-Тест; 0555000411{enter}Тест-Дент; 0555000402{enter}Без контактов')
  await user.click(within(box).getByRole('button', { name: 'Проверить' }))

  const summary = await within(box).findByLabelText('Итог проверки')
  expect(summary).toHaveTextContent('Новых: 1')
  expect(summary).toHaveTextContent('Уже есть: 1')
  expect(summary).toHaveTextContent('Ошибок: 1')
  const table = within(box).getByRole('table', { name: 'Проверка списка' })
  expect(within(table).getByText('Уже в воронке: «Тест-Дент» — тот же телефон')).toBeInTheDocument()
  expect(within(table).getByText('Нужен телефон или ссылка — иначе как написать?')).toBeInTheDocument()
  expect(sent[0]).toEqual({ url: '/api/platform/outreach/import/preview', text: 'Новая-Тест; 0555000411\nТест-Дент; 0555000402\nБез контактов', city: 'Бишкек' })

  await user.click(within(box).getByRole('button', { name: 'Добавить клиник: 1' }))
  expect(await within(box).findByRole('status')).toHaveTextContent('Добавлено клиник: 1')
  expect(sent[1]!.url).toBe('/api/platform/outreach/import')
})

test('«Не беспокоить» — отказ с причиной', async () => {
  let body: unknown = null
  server.use(http.post('*/api/platform/outreach/:id/decline', async ({ request }) => {
    body = await request.json()
    return HttpResponse.json(lead(4, 'Тест-Ёлка', { stage: 'LOST', lostReason: 'Дорого' }))
  }))
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Ёлка' })
  await user.click(within(card).getByRole('button', { name: 'Не беспокоить' }))
  await user.type(within(card).getByRole('textbox', { name: 'Почему — для себя' }), 'Дорого')
  await user.click(within(card).getByRole('button', { name: 'Больше не писать' }))
  await waitFor(() => expect(body).toEqual({ reason: 'Дорого' }))
})

test('«🎬 Отправить ролик»: телефон — «Поделиться» файлом mp4; компьютер — файл скачивается', async () => {
  server.use(http.get('*/web/materials/public/promo.mp4', () => new HttpResponse('mp4', { headers: { 'Content-Type': 'video/mp4' } })))
  const shared: File[][] = []
  Object.assign(navigator, {
    canShare: (d: { files?: File[] }) => !!d.files?.length,
    share: (d: { files: File[] }) => { shared.push(d.files); return Promise.resolve() },
  })
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  await user.click(within(card).getByRole('button', { name: '🎬 Отправить ролик' }))
  expect(await within(card).findByText('Ролик отправлен через «Поделиться».')).toBeInTheDocument()
  expect(shared[0]?.[0]?.name).toBe('Tish-rolik.mp4')
  expect(shared[0]?.[0]?.type).toBe('video/mp4')

  // Нет «Поделиться» файлом (компьютер) — скачивание
  Object.assign(navigator, { canShare: () => false })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  if (!('createObjectURL' in URL)) Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  await user.click(within(card).getByRole('button', { name: '🎬 Отправить ролик' }))
  expect(await within(card).findByText(/Ролик скачан/)).toBeInTheDocument()
  expect(click).toHaveBeenCalled()
})

test('«＋ Добавить клинику» по одной: отправляет одну строку с заголовками; дубль — понятный текст', async () => {
  const sent: string[] = []
  server.use(http.post('*/api/platform/outreach/import', async ({ request }) => {
    const form = await request.formData()
    sent.push(String(form.get('text')).replace(/\r\n/g, '\n'))
    const dup = sent.length > 1
    return HttpResponse.json({ total: 1, fresh: dup ? 0 : 1, duplicates: dup ? 1 : 0, errors: 0, added: dup ? 0 : 1,
      rows: [{ line: 2, clinicName: 'Тест-Новая', status: dup ? 'DUPLICATE' : 'NEW' }] } satisfies Schemas['ClinicOutreachImportReport'])
  }))
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: '＋ Добавить клинику' }))
  const form = screen.getByRole('form', { name: 'Добавить клинику' })
  const add = within(form).getByRole('button', { name: 'Добавить' })
  await user.type(within(form).getByLabelText('Название *'), 'Тест-Новая')
  expect(add).toBeDisabled()
  await user.type(within(form).getByLabelText('Телефон (WhatsApp)'), '0555 000 111')
  await user.click(add)
  expect(await within(form).findByText(/Добавлена «Тест-Новая»/)).toBeInTheDocument()
  expect(sent[0]).toBe('Название\tТелефон\tАдрес\tСсылка\nТест-Новая\t0555 000 111\t\t')
  await user.type(within(form).getByLabelText('Название *'), 'Тест-Новая')
  await user.type(within(form).getByLabelText('Телефон (WhatsApp)'), '0555 000 111')
  await user.click(add)
  expect(await within(form).findByText(/уже есть в списке/)).toBeInTheDocument()
})

test('адрес сайта без https:// в тексте — становится ссылкой https://', () => {
  expect(messageFor('Подробнее о нас: tish.kg/about', 'Тест')).toBe('Подробнее о нас: https://tish.kg/about')
  expect(messageFor('Сайт https://tish.kg/about', 'Тест')).toBe('Сайт https://tish.kg/about')
})

test('«Удалить из списка» — после подтверждения запрос DELETE, клиника уходит', async () => {
  const deleted: string[] = []
  server.use(http.delete('*/api/platform/outreach/:id', ({ params }) => {
    deleted.push(String(params.id))
    return new HttpResponse(null, { status: 204 })
  }))
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  await user.click(within(card).getByRole('button', { name: 'Тест-Дент' }))
  await user.click(within(card).getByRole('button', { name: 'Удалить из списка' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Удалить «Тест-Дент» из списка?')
  await user.click(within(dialog).getAllByRole('button').find((b) => /Удалить/.test(b.textContent ?? ''))!)
  await waitFor(() => expect(deleted).toEqual(['2']))
})
