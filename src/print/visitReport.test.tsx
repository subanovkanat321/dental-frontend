import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'

type Appointment = Schemas['AppointmentView']

const visit: Appointment = appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1, serviceName: 'Пломба' })

/** Памятка клиники к услуге — вымышленная, как её отдаёт сервер (телефон уже подставлен). */
const CARE = '• Не ешьте 2 часа.\n\nЗвоните в клинику: +996 555 000 000.'

const MEMO = {
  memoId: 3, title: 'После пломбы', body: CARE, text: '📋 Памятка после приёма\n\nПосле пломбы', telegram: false,
} satisfies Schemas['CareMemosAppointmentMemo']

function backend(draft: Schemas['VisitReportsDraft'], memo: Schemas['CareMemosAppointmentMemo'] = MEMO) {
  const calls: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === 1 ? [visit] : [])),
    http.get('*/api/appointments/:id/care-memo', ({ request }) => {
      const chosen = new URL(request.url).searchParams.get('memoId')
      return HttpResponse.json(chosen ? { memoId: Number(chosen), title: 'После чистки', body: 'Не пейте кофе.', telegram: false } : memo)
    }),
    http.get('*/api/care-memos', () => HttpResponse.json([
      { id: 3, title: 'После пломбы', active: true }, { id: 4, title: 'После чистки', active: true },
    ] satisfies Schemas['CareMemosCareMemoView'][])),
    http.post('*/api/appointments/:id/visit-report/draft', () => {
      calls.push('draft')
      return HttpResponse.json(draft)
    }),
    http.put('*/api/clinic/visit-report-ai', async ({ request }) => {
      calls.push(await request.json())
      return HttpResponse.json({ available: true, on: true })
    }),
    http.post('*/api/appointments/:id/visit-report/send', async ({ request }) => {
      calls.push(await request.json())
      return HttpResponse.json({ text: '🦷 После приёма\n\nТекст', telegram: false } satisfies Schemas['PatientMessage'])
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

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
  vi.spyOn(window, 'print').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('одно сообщение вместо отчёта и памятки: черновик, уход дома — памятка, правка, WhatsApp; админ может включить ИИ', async () => {
  const calls = backend({ text: 'Здравствуйте, Бакыт М.!\n\nСегодня…', care: { memoId: 3, title: 'После пломбы', text: CARE },
    ai: false, aiAvailable: true, lang: 'RU', telegram: false })
  renderApp()
  const b = await box()
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  // Одна кнопка, второй памятки на карточке нет
  expect(within(panel).getAllByRole('button', { name: /Составить/ })).toHaveLength(1)
  expect(within(panel).queryByRole('button', { name: /памятка «После пломбы»/ })).not.toBeInTheDocument()
  expect(await within(b).findByText(/уход дома — из памятки «После пломбы»/)).toBeInTheDocument()

  await userEvent.click(within(b).getByRole('button', { name: 'Составить сообщение' }))
  const text = await within(b).findByRole('textbox', { name: 'Текст сообщения' })
  expect(text).toHaveValue('Здравствуйте, Бакыт М.!\n\nСегодня…')
  expect(within(b).getByRole('textbox', { name: 'Уход дома' })).toHaveValue(CARE)
  expect(b).toHaveTextContent('памятка «После пломбы»')
  expect(b).toHaveTextContent('По шаблону')
  expect(within(b).queryByRole('button', { name: /Отправить в Telegram/ })).not.toBeInTheDocument()
  await userEvent.type(text, ' Ждём через неделю.')
  await userEvent.click(within(b).getByRole('button', { name: 'WhatsApp' }))
  expect(await within(b).findByRole('status')).toHaveTextContent('Сообщение отправлено в WhatsApp')
  expect(calls).toContainEqual({ text: 'Здравствуйте, Бакыт М.!\n\nСегодня… Ждём через неделю.', care: CARE, ai: false, via: 'WHATSAPP' })
  expect(window.open).toHaveBeenCalled()

  // ИИ на сервере есть, клиника не включила — админу кнопка «Включить», после неё черновик заново
  await userEvent.click(within(b).getByRole('button', { name: 'Включить ИИ для отчётов клиники' }))
  await vi.waitFor(() => expect(calls).toContainEqual({ on: true }))
  await vi.waitFor(() => expect(calls.filter((c) => c === 'draft')).toHaveLength(2))
})

test('уход можно поправить в этом сообщении и вернуть текст памятки; печать — с уходом', async () => {
  const calls = backend({ text: 'Здравствуйте!', care: { memoId: 3, title: 'После пломбы', text: CARE }, ai: true, aiAvailable: true,
    lang: 'RU', telegram: false })
  renderApp()
  const b = await box()
  await userEvent.click(within(b).getByRole('button', { name: 'Составить сообщение' }))
  const care = await within(b).findByRole('textbox', { name: 'Уход дома' })
  await userEvent.clear(care)
  await userEvent.type(care, 'Только мягкая пища.')
  await userEvent.click(within(b).getByRole('button', { name: 'вернуть текст памятки' }))
  expect(care).toHaveValue(CARE)
  await userEvent.clear(care)
  await userEvent.type(care, 'Только мягкая пища.')

  await userEvent.click(within(b).getByRole('button', { name: '🖨 Печать' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: После приёма' })
  expect(within(sheet).getByRole('heading', { name: 'Уход дома' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Только мягкая пища.')
  expect(calls).toContainEqual({ text: 'Здравствуйте!', care: 'Только мягкая пища.', ai: true, via: 'PRINT' })
})

test('ИИ на кыргызском, пациент в Telegram — «Отправить в Telegram», заголовок ухода по-кыргызски', async () => {
  const calls = backend({ text: 'Саламатсызбы!', care: { memoId: 3, title: 'После пломбы', text: CARE }, ai: true, aiAvailable: true,
    lang: 'KY', telegram: true })
  renderApp()
  const b = await box()
  await userEvent.click(within(b).getByRole('button', { name: 'Составить сообщение' }))
  expect(await within(b).findByText(/Написал ИИ/)).toHaveTextContent('на кыргызском')
  expect(b).toHaveTextContent('Үйдө кам көрүү')
  await userEvent.click(within(b).getByRole('button', { name: '📤 Отправить в Telegram' }))
  expect(await within(b).findByRole('status')).toHaveTextContent('Сообщение отправлено в Telegram')
  expect(calls).toContainEqual({ text: 'Саламатсызбы!', care: CARE, ai: true, via: 'TELEGRAM' })
})

test('распечатать только памятку — лист на руки, без личной части', async () => {
  const calls = backend({ text: 'Здравствуйте!', ai: false, aiAvailable: false, lang: 'RU', telegram: false })
  renderApp()
  const b = await box()
  await userEvent.click(await within(b).findByRole('button', { name: 'Распечатать только памятку' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: Памятка пациенту' })
  expect(within(sheet).getByRole('heading', { name: 'После пломбы' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Не ешьте 2 часа.')
  expect(calls).not.toContain('draft')
})

test('у услуги нет памятки — блока ухода нет, подсказка и можно взять уход из другой памятки', async () => {
  const calls = backend({ text: 'Здравствуйте!', ai: false, aiAvailable: false, lang: 'RU', telegram: false }, { telegram: false })
  renderApp()
  const b = await box()
  expect(await within(b).findByText(/У услуги нет памятки/)).toBeInTheDocument()
  expect(within(b).getByRole('link', { name: 'выбрать в «Услугах и ценах»' })).toHaveAttribute('href', '#/settings/services')
  expect(within(b).queryByRole('button', { name: 'Распечатать только памятку' })).not.toBeInTheDocument()

  await userEvent.click(within(b).getByRole('button', { name: 'Составить сообщение' }))
  await within(b).findByRole('textbox', { name: 'Текст сообщения' })
  expect(within(b).queryByRole('textbox', { name: 'Уход дома' })).not.toBeInTheDocument()
  await userEvent.click(within(b).getByRole('button', { name: 'WhatsApp' }))
  await vi.waitFor(() => expect(calls).toContainEqual({ text: 'Здравствуйте!', ai: false, via: 'WHATSAPP' }))

  await choose(within(b).getByRole('combobox', { name: 'Уход дома из памятки' }), 'После чистки')
  expect(await within(b).findByRole('textbox', { name: 'Уход дома' })).toHaveValue('Не пейте кофе.')
})
