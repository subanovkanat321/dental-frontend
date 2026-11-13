import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, findSub } from '../test/fixtures'
import { choose, chosen } from '../test/select'
import { server } from '../test/server'
import { forgetVideo, messageFor, nextLead, remindDue } from './outreach'

type Lead = Schemas['SalesFunnelLead']

/** Вымышленные клиники — настоящих в тестах не бывает. */
function lead(id: number, clinicName: string, extra: Partial<Lead> = {}): Lead {
  return {
    id, clinicName, phone: `99655500040${id}`, city: 'Бишкек', stage: 'LEAD', source: 'LIST', solo: false,
    createdAt: '2026-11-08T05:00:00Z', stageAt: '2026-11-08T05:00:00Z', ...extra,
  }
}

const TEMPLATE = 'Здравствуйте, {клиника}! 😊\nМы — Tish. Подробнее: tish.kg/about'
const VIDEO_TEXT = 'Спасибо! Вот минута 👇\n👨‍⚕️ зарплата врачам'
const REMINDER = 'Добрый день! Канат, по программе. 10 минут?'
const TEXTS = { videoText: VIDEO_TEXT, reminderText: REMINDER, remindAfterDays: 3 }
const owner = { ...me, owner: true, platform: true }

function outreach(leads: Lead[]): Schemas['ClinicOutreachOutreach'] {
  const n = (stages: string[]) => leads.filter((l) => stages.includes(l.stage!)).length
  return {
    counts: { fresh: n(['LEAD']), sent: n(['CONTACTED']), further: n(['DEMO', 'TRIAL', 'PAYING']), declined: n(['LOST']) },
    leads, template: { text: TEMPLATE, custom: false, defaultText: TEMPLATE, ...TEXTS },
  }
}

let leads: Lead[]
/** Сколько раз качали ролик — должен один раз на вкладку, а не на каждую клинику. */
let videoFetches = 0

/** Владелец ушёл в WhatsApp и вернулся: вкладка скрылась и снова видна. */
function leaveAndReturn() {
  for (const state of ['hidden', 'visible']) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
  }
}

/** Телефон: «Поделиться» файлом есть; что поделились — в shared. */
function phoneShare(shared: File[][]) {
  Object.assign(navigator, {
    canShare: (d: { files?: File[] }) => !!d.files?.length,
    share: (d: { files: File[] }) => { shared.push(d.files); return Promise.resolve() },
  })
}

beforeEach(() => {
  forgetVideo()
  videoFetches = 0
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
    http.get('*/web/materials/public/promo.mp4', () => {
      videoFetches++
      return new HttpResponse('mp4', { headers: { 'Content-Type': 'video/mp4' } })
    }),
  )
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'canShare')
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(document, 'visibilityState')
  window.location.hash = ''
  vi.restoreAllMocks()
})

async function openTab() {
  const user = userEvent.setup()
  renderApp()
  await user.click(await findSub('Написать клиникам'))
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

test('«📨 Отправить сообщение» — только текст в wa.me (без ролика), «Отправили? — Да» ставит отметку', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  let marked: string | null = null
  server.use(http.post('*/api/platform/outreach/:id/sent', ({ params }) => {
    marked = String(params.id)
    leads = leads.map((l) => l.id === 2 ? { ...l, stage: 'CONTACTED', contactedAt: '2026-11-08T06:00:00Z' } : l)
    return HttpResponse.json(leads.find((l) => l.id === 2))
  }))
  const user = await openTab()

  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  // Неписаным ролик не предлагаем — ни шагом, ни отдельной кнопкой
  expect(within(card).queryByRole('button', { name: 'Только ролик' })).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: /Ответили/ })).not.toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: '📨 Отправить сообщение' }))
  const text = 'Здравствуйте, Тест-Дент! 😊\nМы — Tish. Подробнее: https://tish.kg/about'
  expect(within(card).queryByText(/Текст открыт в WhatsApp/)).not.toBeInTheDocument()
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555000402&text=${encodeURIComponent(text)}`, '_blank', 'noopener')

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
  expect(within(lost).queryByRole('button', { name: '📨 Отправить сообщение' })).not.toBeInTheDocument()
  expect(within(lost).queryByRole('button', { name: /Напомнить/ })).not.toBeInTheDocument()
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

test('загрузка списка: вставка → предпросмотр (дубли — спокойно «пропустим», ошибки не мешают) → добавить', async () => {
  const sent: { url: string; text: string | null; city: string | null }[] = []
  const report = (added: number): Schemas['ClinicOutreachImportReport'] => ({
    total: 3, fresh: 1, duplicates: 1, errors: 1, added,
    rows: [
      { line: 1, clinicName: 'Новая-Тест', phone: '996555000411', city: 'Бишкек', status: 'NEW' },
      { line: 2, clinicName: 'Тест-Дент', phone: '996555000402', city: 'Бишкек', status: 'DUPLICATE', message: 'Уже в списке: «Тест-Дент» — тот же телефон' },
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
  expect(summary).toHaveTextContent('уже в списке — пропустим: 1')
  expect(within(summary).getByText(/уже в списке/).closest('.chip')).not.toHaveClass('s-bad')
  expect(summary).toHaveTextContent('С ошибкой — не добавим: 1')
  expect(within(box).getByText(/Строки с ошибкой загрузке не мешают/)).toBeInTheDocument()
  const table = within(box).getByRole('table', { name: 'Проверка списка' })
  const dup = within(table).getByText('пропустим · Уже в списке: «Тест-Дент» — тот же телефон')
  expect(dup).not.toHaveClass('tone-bad')
  expect(within(table).getByText('Нужен телефон или ссылка — иначе как написать?')).toBeInTheDocument()
  expect(sent[0]).toEqual({ url: '/api/platform/outreach/import/preview', text: 'Новая-Тест; 0555000411\nТест-Дент; 0555000402\nБез контактов', city: 'Бишкек' })

  await user.click(within(box).getByRole('button', { name: 'Добавить клиник: 1' }))
  expect(await within(box).findByRole('status')).toHaveTextContent('Добавлено клиник: 1. Они — в «Не писали», по порядку списка. Уже были в списке — пропустили: 1. С ошибками — не добавили: 1.')
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

test('«Только ролик»: телефон — «Поделиться» файлом mp4; компьютер — файл скачивается', async () => {
  const shared: File[][] = []
  phoneShare(shared)
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Улыбка' })
  await user.click(within(card).getByRole('button', { name: 'Только ролик' }))
  expect(await within(card).findByText('Ролик отправлен через «Поделиться».')).toBeInTheDocument()
  expect(shared[0]?.[0]?.name).toBe('Tish-rolik.mp4')
  expect(shared[0]?.[0]?.type).toBe('video/mp4')

  // Нет «Поделиться» файлом (компьютер) — скачивание
  Object.assign(navigator, { canShare: () => false })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  if (!('createObjectURL' in URL)) Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  await user.click(within(card).getByRole('button', { name: 'Нет' }))
  await user.click(within(card).getByRole('button', { name: 'Только ролик' }))
  expect(await within(card).findByText(/Ролик скачан/)).toBeInTheDocument()
  expect(click).toHaveBeenCalled()
  expect(videoFetches).toBe(1)
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
  // Телефон — PhoneInput: страна (по умолчанию Кыргызстан) и номер
  expect(chosen(within(form).getByRole('combobox', { name: 'Код страны' }))).toContain('🇰🇬 +996')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон (WhatsApp)' }), '0555 000 111')
  await user.click(add)
  expect(await within(form).findByText(/Добавлена «Тест-Новая»/)).toBeInTheDocument()
  expect(sent[0]).toBe('Название\tТелефон\tАдрес\tСсылка\nТест-Новая\t0555 000 111\t\t')
  await user.type(within(form).getByLabelText('Название *'), 'Тест-Новая')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон (WhatsApp)' }), '0555 000 111')
  await user.click(add)
  expect(await within(form).findByText(/Этот номер уже в списке/)).toBeInTheDocument()
  // Номер другой страны: выбрали Казахстан — уходит с кодом +7
  await user.clear(within(form).getByLabelText('Название *'))
  await user.type(within(form).getByLabelText('Название *'), 'Алма-Тест')
  await user.clear(within(form).getByRole('textbox', { name: 'Телефон (WhatsApp)' }))
  await choose(within(form).getByRole('combobox', { name: 'Код страны' }), 'KZ')
  await user.type(within(form).getByRole('textbox', { name: 'Телефон (WhatsApp)' }), '701 000 00 03')
  await user.click(add)
  await waitFor(() => expect(sent[2]).toBe('Название\tТелефон\tАдрес\tСсылка\nАлма-Тест\t+7 701 000 00 03\t\t'))
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

test('«Шаблон Excel» (ответившим) — третьим сообщением: «Вот шаблон — заполните, и мы всё перенесём» со ссылкой', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Улыбка' })
  await user.click(within(card).getByRole('button', { name: 'Шаблон Excel' }))
  const text = `Вот шаблон — заполните, и мы всё перенесём: ${window.location.origin}/web/import/tish-perenos.xlsx\n`
    + 'Пациенты, прайс, врачи, склад, будущие записи и долги — каждое на своём листе. Пустые листы можно не трогать.'
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555000401&text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  // И после ролика, в «Отправили?» — та же кнопка
  const ask = within(card).getByRole('group', { name: 'Отправили?' })
  await user.click(within(ask).getByRole('button', { name: '📥 Ещё и шаблон Excel' }))
  expect(open).toHaveBeenCalledTimes(2)
})

test('«🎬 Ответили — отправить ролик»: ① текст №2 в wa.me → возврат → ② «Поделиться» роликом → «Да» — этап «Демо» → «Следующая»', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const shared: File[][] = []
  phoneShare(shared)
  leads = leads.map((l) => l.id === 1 ? { ...l, note: 'Звонить после обеда', nextStep: 'Показать', nextStepOn: '2026-11-20' } : l)
  const bodies: unknown[] = []
  server.use(http.put('*/api/platform/funnel/:id', async ({ request, params }) => {
    bodies.push({ id: String(params.id), ...(await request.json() as object) })
    leads = leads.map((l) => l.id === 1 ? { ...l, stage: 'DEMO' } : l)
    return HttpResponse.json(leads.find((l) => l.id === 1))
  }))
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Улыбка' })
  await user.click(within(card).getByRole('button', { name: '🎬 Ответили — отправить ролик' }))
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555000401&text=${encodeURIComponent(VIDEO_TEXT)}`, '_blank', 'noopener')
  expect(within(card).getByText(/Текст открыт в WhatsApp/)).toBeInTheDocument()
  expect(within(card).queryByRole('group', { name: 'Шаг 2: ролик' })).not.toBeInTheDocument()
  // Пока владелец в WhatsApp, ролик уже качается в память
  await waitFor(() => expect(videoFetches).toBe(1))

  leaveAndReturn()
  const step2 = await within(card).findByRole('group', { name: 'Шаг 2: ролик' })
  expect(step2).toHaveTextContent('выберите этот чат (он первый в списке)')
  await user.click(within(step2).getByRole('button', { name: '🎬 Отправить ролик' }))
  // «Поделиться» — сразу по нажатию, из готового файла (без повторного скачивания)
  expect(shared).toHaveLength(1)
  expect(shared[0]?.[0]?.name).toBe('Tish-rolik.mp4')
  expect(shared[0]?.[0]?.type).toBe('video/mp4')

  const ask = await within(card).findByRole('group', { name: 'Отправили?' })
  expect(ask).toHaveTextContent('перейдёт в «Ответили»')
  // Третьим — шаблон Excel
  await user.click(within(ask).getByRole('button', { name: '📥 Ещё и шаблон Excel' }))
  expect(open).toHaveBeenCalledTimes(2)
  await user.click(within(ask).getByRole('button', { name: 'Да' }))
  const done = await within(card).findByRole('group', { name: 'Отмечено' })
  expect(done).toHaveTextContent('в «Ответили/дальше»')
  // Тот же запрос, что в воронке: этап «Демо», заметка и следующий шаг — как были
  expect(bodies).toEqual([{ id: '1', stage: 'DEMO', note: 'Звонить после обеда', nextStep: 'Показать', nextStepOn: '2026-11-20' }])
  await user.click(within(done).getByRole('button', { name: 'Следующая клиника →' }))
  expect(screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })).toHaveAttribute('aria-current', 'true')

  // Другая клиника — ролик тот же, из памяти: второй раз не качаем
  const further = screen.getByRole('listitem', { name: 'Клиника: Тест-Демо' })
  await user.click(within(further).getByRole('button', { name: 'Только ролик' }))
  expect(shared).toHaveLength(2)
  expect(videoFetches).toBe(1)
  // Уже дальше «Демо» — «Да» этап не трогает
  await user.click(within(within(further).getByRole('group', { name: 'Отправили?' })).getByRole('button', { name: 'Да' }))
  expect(await within(further).findByRole('group', { name: 'Отмечено' })).toBeInTheDocument()
  expect(bodies).toHaveLength(1)
})

test('«🔁 Напомнить» — написали 3+ дня назад и ещё не напоминали; один раз', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const now = new Date('2026-11-13T06:00:00Z')
  const sentOn = (contactedAt: string, extra: Partial<Lead> = {}) => lead(9, 'А', { stage: 'CONTACTED', contactedAt, ...extra })
  // Считаем по календарю Бишкека: 10-е (вечер по UTC — уже 11-е в Бишкеке) → 2 дня, рано
  expect(remindDue(sentOn('2026-11-10T19:00:00Z'), 3, now)).toBe(false)
  expect(remindDue(sentOn('2026-11-10T05:00:00Z'), 3, now)).toBe(true)
  expect(remindDue(sentOn('2026-11-01T05:00:00Z', { remindedAt: '2026-11-05T05:00:00Z' }), 3, now)).toBe(false)
  expect(remindDue(sentOn('2026-11-01T05:00:00Z', { stage: 'DEMO' }), 3, now)).toBe(false)
  expect(remindDue(lead(9, 'А'), 3, now)).toBe(false)

  let reminded: string | null = null
  server.use(http.post('*/api/platform/outreach/:id/reminded', ({ params }) => {
    reminded = String(params.id)
    leads = leads.map((l) => l.id === 1 ? { ...l, remindedAt: '2026-11-13T06:00:00Z' } : l)
    return HttpResponse.json(leads.find((l) => l.id === 1))
  }))
  leads.push(lead(6, 'Тест-Вчера', { stage: 'CONTACTED', contactedAt: new Date().toISOString() }))
  const user = await openTab()
  // Написали только что — напоминать рано
  expect(within(screen.getByRole('listitem', { name: 'Клиника: Тест-Вчера' })).queryByRole('button', { name: '🔁 Напомнить' })).not.toBeInTheDocument()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Улыбка' })
  await user.click(within(card).getByRole('button', { name: '🔁 Напомнить' }))
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555000401&text=${encodeURIComponent(REMINDER)}`, '_blank', 'noopener')
  const ask = within(card).getByRole('group', { name: 'Отправили?' })
  expect(ask).toHaveTextContent('Напомнили «Тест-Улыбка»?')
  expect(within(ask).queryByRole('button', { name: '📥 Ещё и шаблон Excel' })).not.toBeInTheDocument()
  await user.click(within(ask).getByRole('button', { name: 'Да' }))
  await waitFor(() => expect(reminded).toBe('1'))
  const done = await within(card).findByRole('group', { name: 'Отмечено' })
  expect(done).toHaveTextContent('напомнили')
  await user.click(within(done).getByRole('button', { name: 'Следующая клиника →' }))
  // Напомнили — кнопки больше нет, в карточке дата напоминания
  await waitFor(() => expect(within(card).queryByRole('button', { name: '🔁 Напомнить' })).not.toBeInTheDocument())
  expect(within(card).getByText(/напомнили/)).toBeInTheDocument()
})

test('шаг ② на компьютере: «Поделиться» файлом нет — ролик скачивается, подсказка про WhatsApp Web', async () => {
  vi.spyOn(window, 'open').mockImplementation(() => null)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  if (!('createObjectURL' in URL)) Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Улыбка' })
  await user.click(within(card).getByRole('button', { name: '🎬 Ответили — отправить ролик' }))
  leaveAndReturn()
  const step2 = await within(card).findByRole('group', { name: 'Шаг 2: ролик' })
  expect(step2).toHaveTextContent('прикрепите его в этот чат WhatsApp Web')
  await user.click(within(step2).getByRole('button', { name: '🎬 Скачать ролик' }))
  expect(await within(card).findByRole('group', { name: 'Отправили?' })).toBeInTheDocument()
  expect(click).toHaveBeenCalled()
})

test('«Изменить» клинику: страна и номер, 409 — номер у другой клиники, потом сохраняется', async () => {
  const bodies: unknown[] = []
  server.use(http.put('*/api/platform/outreach/:id', async ({ request, params }) => {
    const body = await request.json() as Schemas['ClinicOutreachChangeRequest']
    bodies.push({ id: String(params.id), ...body })
    if (bodies.length === 1) {
      return HttpResponse.json({ status: 409, detail: 'Этот номер уже у клиники «Тест-Улыбка» — у одной клиники один номер' }, { status: 409 })
    }
    leads = leads.map((l) => l.id === 2 ? { ...l, clinicName: body.clinicName, phone: '77010000003', address: body.address } : l)
    return HttpResponse.json(leads.find((l) => l.id === 2))
  }))
  leads = leads.map((l) => l.id === 5 ? { ...l, clinicId: 9 } : l)
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  await user.click(within(card).getByRole('button', { name: 'Тест-Дент' }))
  await user.click(within(card).getByRole('button', { name: 'Изменить' }))
  const form = within(card).getByRole('form', { name: 'Изменить: Тест-Дент' })
  expect(within(form).getByLabelText('Название *')).toHaveValue('Тест-Дент')
  expect(within(form).getByRole('textbox', { name: 'Телефон (WhatsApp)' })).toHaveValue('555 000 402')
  expect(within(form).getByLabelText('Адрес')).toHaveValue('ул. Вымышленная, 2')

  await choose(within(form).getByRole('combobox', { name: 'Код страны' }), 'KZ')
  const phone = within(form).getByRole('textbox', { name: 'Телефон (WhatsApp)' })
  await user.clear(phone)
  await user.type(phone, '701 000 00 03')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('Этот номер уже у клиники «Тест-Улыбка»')
  expect(bodies[0]).toEqual({ id: '2', clinicName: 'Тест-Дент', phone: '+7 701 000 00 03', address: 'ул. Вымышленная, 2', link: '', city: 'Бишкек' })

  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(within(card).queryByRole('form', { name: /Изменить/ })).not.toBeInTheDocument())
  expect(await within(card).findByText(/\+7 701 000 00 03/)).toBeInTheDocument()

  // Подключённая клиника — «Изменить» нет, подсказка про «Клиники»
  const connected = screen.getByRole('listitem', { name: 'Клиника: Тест-Демо' })
  await user.click(within(connected).getByRole('button', { name: 'Тест-Демо' }))
  expect(within(connected).getByText(/правят в «Клиниках»/)).toBeInTheDocument()
  expect(within(connected).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
})

test('«Скачать шаблон» в окне загрузки: Excel и CSV с сервера', async () => {
  const asked: string[] = []
  server.use(http.get('*/api/platform/outreach/import/template', ({ request }) => {
    asked.push(new URL(request.url).search)
    return new HttpResponse('x', { headers: { 'Content-Type': 'text/csv' } })
  }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  if (!('createObjectURL' in URL)) Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  const user = await openTab()
  await user.click(screen.getByRole('button', { name: 'Загрузить список клиник' }))
  const box = screen.getByRole('group', { name: 'Загрузить список клиник' })
  await user.click(within(box).getByRole('button', { name: 'Excel (.xlsx)' }))
  await user.click(within(box).getByRole('button', { name: 'CSV' }))
  await waitFor(() => expect(asked).toEqual(['?format=xlsx', '?format=csv']))
  await waitFor(() => expect(click).toHaveBeenCalledTimes(2))
  expect(box).toHaveTextContent('«Название, Телефон, Адрес, Ссылка, Город»')
})

test('Windows: текст сразу в поле чата, без эмодзи (из ссылки они приходят «�»)', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')
  const user = await openTab()
  const card = screen.getByRole('listitem', { name: 'Клиника: Тест-Дент' })
  await user.click(within(card).getByRole('button', { name: '📨 Отправить сообщение' }))
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555000402&text=${encodeURIComponent('Здравствуйте, Тест-Дент!\nМы — Tish. Подробнее: https://tish.kg/about')}`, '_blank', 'noopener')
  // Текст к ролику — тоже без эмодзи (👇, 👨‍⚕️)
  await user.click(within(screen.getByRole('listitem', { name: 'Клиника: Тест-Улыбка' })).getByRole('button', { name: '🎬 Ответили — отправить ролик' }))
  expect(open).toHaveBeenLastCalledWith(`https://api.whatsapp.com/send/?phone=996555000401&text=${encodeURIComponent('Спасибо! Вот минута\nзарплата врачам')}`, '_blank', 'noopener')
})

test('шаблон: свой текст → «Вернуть текст по умолчанию» шлёт пустое значение, сервер отдаёт текст по умолчанию', async () => {
  const DEFAULT = 'Здравствуйте, {клиника}! Если интересно — просто ответьте «+»'
  let template: Schemas['ClinicOutreachTemplate'] = { text: 'Свой, {клиника}!', custom: true, defaultText: DEFAULT, ...TEXTS }
  const puts: (string | undefined)[] = []
  server.use(
    http.get('*/api/platform/outreach', () => HttpResponse.json({ ...outreach(leads), template })),
    http.put('*/api/platform/outreach/template', async ({ request }) => {
      const { text } = await request.json() as { text?: string }
      puts.push(text)
      template = text ? { text, custom: true, defaultText: DEFAULT, ...TEXTS } : { text: DEFAULT, custom: false, defaultText: DEFAULT, ...TEXTS }
      return HttpResponse.json(template)
    }),
  )
  const user = await openTab()
  const block = screen.getByRole('region', { name: 'Текст сообщения' })
  await user.click(within(block).getByText('Текст сообщения (свой)'))
  expect(within(block).getByRole('textbox', { name: 'Текст' })).toHaveValue('Свой, {клиника}!')
  // Текст к ролику и напоминание — видно, но не правится
  expect(within(block).getByLabelText('Текст к ролику')).toHaveTextContent('Спасибо! Вот минута')
  expect(within(block).getByLabelText('Текст напоминания')).toHaveTextContent(REMINDER)

  await user.click(within(block).getByRole('button', { name: 'Вернуть текст по умолчанию' }))
  await waitFor(() => expect(within(block).getByRole('textbox', { name: 'Текст' })).toHaveValue(DEFAULT))
  expect(puts).toEqual([''])
  // Текст снова по умолчанию — кнопки «Вернуть» нет, пометки «(свой)» тоже
  await waitFor(() => expect(within(block).queryByRole('button', { name: 'Вернуть текст по умолчанию' })).not.toBeInTheDocument())
  expect(within(block).getByText('Текст сообщения')).toBeInTheDocument()
})
