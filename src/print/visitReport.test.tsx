import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']
type Draft = Schemas['VisitReportsDraft']

const visit: Appointment = appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1, serviceName: 'Пломба' })

/** Памятка клиники к услуге — вымышленная, как её отдаёт сервер (телефон уже подставлен). */
const CARE = '• Не ешьте 2 часа.\n\nЗвоните в клинику: +996 555 000 000.'

const MEMO = {
  memoId: 3, title: 'После пломбы', body: CARE, text: '📋 Памятка после приёма\n\nПосле пломбы\n\n' + CARE + '\n\n— Tish Dent', telegram: false, ky: false,
} satisfies Schemas['CareMemosAppointmentMemo']

/** Что вернёт предпросмотр: сервер собирает заголовок, текст, уход и подпись — тот же текст уйдёт пациенту. */
const PREVIEW = '🦷 После приёма\n\nЗдравствуйте, Бакыт М.!\n\nУход дома:\n• Не ешьте 2 часа.\n\nВрач: Асанов Б., +996 700 123 456\nКлиника Tish Dent: +996 312 000 111'

function backend(draft: Draft, { memo = MEMO, ai = false, telegram = false, parts = 1 }: {
  memo?: Schemas['CareMemosAppointmentMemo']; ai?: boolean; telegram?: boolean; parts?: number
} = {}) {
  const calls: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === 1 ? [visit] : [])),
    http.get('*/api/clinic/visit-report-ai', () => HttpResponse.json({ available: true, on: ai })),
    http.get('*/api/appointments/:id/care-memo', ({ request }) => {
      const chosen = new URL(request.url).searchParams.get('memoId')
      return HttpResponse.json(chosen ? { memoId: Number(chosen), title: 'После чистки', body: 'Не пейте кофе.', telegram: false } : memo)
    }),
    http.get('*/api/care-memos', () => HttpResponse.json([
      { id: 3, title: 'После пломбы', active: true, standard: false, kyStandard: false }, { id: 4, title: 'После чистки', active: true, standard: false, kyStandard: false },
    ] satisfies Schemas['CareMemosCareMemoView'][])),
    http.post('*/api/appointments/:id/visit-report/draft', ({ request }) => {
      calls.push(`draft:${new URL(request.url).searchParams.get('mode')}`)
      return HttpResponse.json(draft)
    }),
    http.post('*/api/appointments/:id/visit-report/preview', async ({ request }) => {
      calls.push({ preview: await request.json() })
      return HttpResponse.json({ text: PREVIEW, parts, telegram, lang: draft.lang } satisfies Schemas['VisitReportsPreview'])
    }),
    http.put('*/api/clinic/visit-report-ai', async ({ request }) => {
      calls.push(await request.json())
      return HttpResponse.json({ available: true, on: true })
    }),
    http.post('*/api/appointments/:id/visit-report/send', async ({ request }) => {
      calls.push(await request.json())
      return HttpResponse.json({ text: PREVIEW, telegram } satisfies Schemas['PatientMessage'])
    }),
    http.post('*/api/appointments/:id/care-memo/send', () => {
      calls.push('memo-send')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

async function box() {
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  return screen.findByRole('region', { name: 'Сообщение после приёма' })
}

const DRAFT: Draft = { text: 'Здравствуйте, Бакыт М.!\n\nСегодня…', care: { memoId: 3, title: 'После пломбы', text: CARE },
  ai: false, aiAvailable: true, lang: 'RU', telegram: false }

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
  vi.spyOn(window, 'print').mockImplementation(() => {})
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('два входа: «Написать самому» — без ИИ, сразу редактор; предпросмотр точного текста и «Отправить в WhatsApp»', async () => {
  const calls = backend({ ...DRAFT, text: 'Здравствуйте, Бакыт М.!\n\n\n\nДальше по плану:\n• зуб 46 — Лечение каналов' })
  renderApp()
  const b = await box()
  expect(within(b).getByRole('button', { name: 'Написать самому' })).toBeInTheDocument()
  expect(b).toHaveTextContent('Без ИИ')
  // ИИ у клиники выключен — второй вход «по шаблону», и подписано, что будет
  expect(await within(b).findByRole('button', { name: 'Составить по шаблону' })).toBeInTheDocument()
  expect(within(b).queryByRole('button', { name: /с ИИ/ })).not.toBeInTheDocument()

  await userEvent.click(within(b).getByRole('button', { name: 'Написать самому' }))
  const text = await within(b).findByRole('textbox', { name: 'Текст сообщения' })
  expect(calls).toEqual(['draft:SELF'])
  expect(text).toHaveValue('Здравствуйте, Бакыт М.!\n\n\n\nДальше по плану:\n• зуб 46 — Лечение каналов')
  expect(b).toHaveTextContent('Своими словами')
  // Курсор — под приветствием
  expect(text).toHaveFocus()
  expect((text as HTMLTextAreaElement).selectionStart).toBe('Здравствуйте, Бакыт М.!\n\n'.length)
  // Без ИИ — и кнопки «Включить ИИ» под своим текстом нет
  expect(within(b).queryByRole('button', { name: 'Включить ИИ для отчётов клиники' })).not.toBeInTheDocument()
  await userEvent.keyboard('Осмотрели зубы.')

  // Сразу отправить нельзя — сначала «Так увидит пациент»
  expect(within(b).queryByRole('button', { name: /Отправить/ })).not.toBeInTheDocument()
  await userEvent.click(within(b).getByRole('button', { name: 'Проверить и отправить' }))
  const preview = await within(b).findByRole('document', { name: 'Предпросмотр сообщения' })
  expect(preview.textContent).toBe(PREVIEW)
  expect(b).toHaveTextContent('Так увидит пациент')
  expect(calls).toContainEqual({ preview: { text: 'Здравствуйте, Бакыт М.!\n\nОсмотрели зубы.\n\nДальше по плану:\n• зуб 46 — Лечение каналов', care: CARE, doctorPhone: false } })

  await userEvent.click(within(b).getByRole('button', { name: 'Отправить в WhatsApp' }))
  expect(await within(b).findByRole('status')).toHaveTextContent('Сообщение отправлено в WhatsApp')
  expect(calls).toContainEqual(expect.objectContaining({ care: CARE, ai: false, via: 'WHATSAPP' }))
  // В WhatsApp — ровно текст с сервера; одиночный «+» не потеряется, номер «+996…» как есть
  const url = decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))
  expect(url).toContain('Врач: Асанов Б., +996 700 123 456')
})

test('«Составить по шаблону» — шаблон; админ может включить ИИ, после — черновик с ИИ', async () => {
  const calls = backend(DRAFT)
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Составить по шаблону' }))
  expect(await within(b).findByRole('textbox', { name: 'Текст сообщения' })).toHaveValue(DRAFT.text)
  expect(calls).toEqual(['draft:TEMPLATE'])
  expect(b).toHaveTextContent('По шаблону')
  await userEvent.click(within(b).getByRole('button', { name: 'Включить ИИ для отчётов клиники' }))
  await waitForSlow(() => expect(calls).toContainEqual({ on: true }))
  await waitForSlow(() => expect(calls).toContain('draft:AI'))
})

test('ИИ у клиники включён — «Составить с ИИ ✨», в ИИ уходят данные приёма без имени', async () => {
  const calls = backend({ ...DRAFT, ai: true }, { ai: true })
  renderApp()
  const b = await box()
  const start = await within(b).findByRole('button', { name: 'Составить с ИИ ✨' })
  expect(b).toHaveTextContent('без имени и телефона пациента')
  await userEvent.click(start)
  expect(await within(b).findByText(/Написал ИИ/)).toBeInTheDocument()
  expect(calls).toEqual(['draft:AI'])
})

test('уход можно поправить и вернуть; печать — второстепенно, из предпросмотра', async () => {
  const calls = backend({ ...DRAFT, ai: true }, { ai: true })
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Составить с ИИ ✨' }))
  const care = await within(b).findByRole('textbox', { name: 'Уход дома' })
  await userEvent.clear(care)
  await userEvent.type(care, 'Только мягкая пища.')
  await userEvent.click(within(b).getByRole('button', { name: 'вернуть текст памятки' }))
  expect(care).toHaveValue(CARE)
  await userEvent.clear(care)
  await userEvent.type(care, 'Только мягкая пища.')

  await userEvent.click(within(b).getByRole('button', { name: 'Проверить и отправить' }))
  await within(b).findByRole('document', { name: 'Предпросмотр сообщения' })
  // Главное — отправить; печать — ссылкой «Ещё: распечатать»
  expect(within(b).getByRole('button', { name: 'Отправить в WhatsApp' })).toHaveClass('primary')
  expect(within(b).queryByRole('button', { name: /Печать/ })).not.toBeInTheDocument()
  await userEvent.click(within(b).getByRole('button', { name: 'распечатать' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: После приёма' })
  expect(within(sheet).getByRole('heading', { name: 'Уход дома' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Только мягкая пища.')
  expect(calls).toContainEqual({ text: DRAFT.text, care: 'Только мягкая пища.', doctorPhone: false, ai: true, via: 'PRINT' })
})

test('кыргызский пациент в Telegram: предпросмотр, переключатель Telegram / WhatsApp, длинное — несколькими сообщениями', async () => {
  const calls = backend({ ...DRAFT, text: 'Саламатсызбы!', ai: true, lang: 'KY', telegram: true }, { ai: true, telegram: true, parts: 2 })
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Составить с ИИ ✨' }))
  expect(await within(b).findByText(/Написал ИИ/)).toHaveTextContent('на кыргызском')
  expect(b).toHaveTextContent('Үйдө кам көрүү')
  await userEvent.click(within(b).getByRole('button', { name: 'Проверить и отправить' }))
  await within(b).findByRole('document', { name: 'Предпросмотр сообщения' })
  expect(b).toHaveTextContent('придёт 2 сообщениями')
  const switcher = within(b).getByRole('group', { name: 'Куда отправить' })
  expect(within(switcher).getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(switcher).getByRole('button', { name: 'WhatsApp' }))
  expect(within(b).getByRole('button', { name: 'Отправить в WhatsApp' })).toBeInTheDocument()
  await userEvent.click(within(switcher).getByRole('button', { name: 'Telegram' }))
  await userEvent.click(within(b).getByRole('button', { name: 'Отправить в Telegram' }))
  expect(await within(b).findByRole('status')).toHaveTextContent('Сообщение отправлено в Telegram')
  expect(calls).toContainEqual({ text: 'Саламатсызбы!', care: CARE, doctorPhone: false, ai: true, via: 'TELEGRAM' })
})

test('номер врача в подписи: галочка «Указать мой номер», выбор запоминается без самого номера', async () => {
  const calls = backend({ ...DRAFT, doctorPhone: '+996 700 123 456' })
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Составить по шаблону' }))
  const box2 = await within(b).findByRole('checkbox', { name: /Указать (мой номер|номер врача) в подписи/ })
  expect(box2).toBeChecked()
  expect(b).toHaveTextContent('+996 700 123 456')
  await userEvent.click(box2)
  await userEvent.click(within(b).getByRole('button', { name: 'Проверить и отправить' }))
  await waitForSlow(() => expect(calls).toContainEqual({ preview: expect.objectContaining({ doctorPhone: false }) }))
  expect(localStorage.getItem('visit-report-doctor-phone')).toBe('0')
  expect(JSON.stringify({ ...localStorage })).not.toContain('700')
})

test('только памятка: главное — «Отправить памятку пациенту» с предпросмотром; печать — «Ещё: распечатать»', async () => {
  const calls = backend(DRAFT)
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Отправить памятку пациенту' }))
  const preview = await within(b).findByRole('document', { name: 'Предпросмотр памятки' })
  expect(preview.textContent).toBe(MEMO.text)
  // Пациент не в Telegram — WhatsApp с тем же текстом
  await userEvent.click(within(b).getByRole('button', { name: 'Отправить в WhatsApp' }))
  expect(decodeURIComponent(String(vi.mocked(window.open).mock.calls[0]?.[0]))).toContain('После пломбы')
  expect(await within(b).findByRole('status')).toHaveTextContent('Памятка открыта в WhatsApp')

  await userEvent.click(within(b).getByRole('button', { name: 'распечатать' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: Памятка пациенту' })
  expect(within(sheet).getByRole('heading', { name: 'После пломбы' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Не ешьте 2 часа.')
  expect(calls.filter((c) => String(c).startsWith('draft'))).toHaveLength(0)
})

test('памятка пациенту в Telegram — бот (тот же отправитель памяток)', async () => {
  const calls = backend(DRAFT, { memo: { ...MEMO, telegram: true } })
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Отправить памятку пациенту' }))
  await userEvent.click(within(b).getByRole('button', { name: 'Отправить в Telegram' }))
  expect(await within(b).findByRole('status')).toHaveTextContent('Памятка отправлена в Telegram')
  expect(calls).toContain('memo-send')
})

test('у услуги нет памятки — блока ухода нет, подсказка и можно взять уход из другой памятки', async () => {
  const calls = backend({ text: 'Здравствуйте!', ai: false, aiAvailable: false, lang: 'RU', telegram: false }, { memo: { telegram: false, ky: false } })
  renderApp()
  const b = await box()
  expect(await within(b).findByText(/У услуги нет памятки/)).toBeInTheDocument()
  expect(within(b).getByRole('link', { name: 'выбрать в «Услугах и ценах»' })).toHaveAttribute('href', '#/clinic/services')
  expect(within(b).queryByRole('button', { name: 'Отправить памятку пациенту' })).not.toBeInTheDocument()

  await userEvent.click(within(b).getByRole('button', { name: 'Составить по шаблону' }))
  await within(b).findByRole('textbox', { name: 'Текст сообщения' })
  expect(within(b).queryByRole('textbox', { name: 'Уход дома' })).not.toBeInTheDocument()
  await choose(within(b).getByRole('combobox', { name: 'Уход дома из памятки' }), 'После чистки')
  expect(await within(b).findByRole('textbox', { name: 'Уход дома' })).toHaveValue('Не пейте кофе.')
  await userEvent.click(within(b).getByRole('button', { name: 'Проверить и отправить' }))
  await waitForSlow(() => expect(calls).toContainEqual({ preview: { text: 'Здравствуйте!', care: 'Не пейте кофе.', doctorPhone: false } }))
})
