import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, openItem } from '../test/fixtures'
import { server } from '../test/server'
import { agreementBlocks, billingLine, fillAgreement } from './texts'

beforeEach(() => {
  window.location.hash = '/settings/plan'
  server.use(http.get('*/api/platform-info', () => HttpResponse.json({ supportUrl: 'https://t.me/tish_support' } satisfies Schemas['PlatformInfoInfo'])))
})
afterEach(() => {
  window.location.hash = ''
})

test('строка оплаты и разбор договора', () => {
  expect(billingLine({ state: 'FREE' }).tone).toBe('hint')
  expect(billingLine({ state: 'ACTIVE', paidUntil: '2026-11-05', daysLeft: 5 })).toEqual({ text: 'оплачено до 5 нояб 2026', tone: 'wait' })
  expect(billingLine({ state: 'PAUSED', paidUntil: '2026-10-01' }).tone).toBe('bad')
  expect(fillAgreement('Клиника {{clinic.name}}, ИНН {{ clinic.inn }}', { 'clinic.name': 'ИП Тест' })).toBe('Клиника ИП Тест, ИНН ________________')
  expect(agreementBlocks('# Договор\n\n> важно\n- пункт\n**Жирный** текст')).toEqual([
    { type: 'heading', text: 'Договор' }, { type: 'note', text: 'важно' }, { type: 'item', text: 'пункт' }, { type: 'para', text: 'Жирный текст' },
  ])
})

test('админ: тариф, оплата за 3 месяца с отметкой «Я оплатил(а)»', async () => {
  let paid: string | null = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/plan', () => HttpResponse.json({
      billing: { state: 'ACTIVE', paidUntil: '2026-12-01', daysLeft: 30 }, doctors: 2,
      tariff: { code: 'SMALL', name: 'Кабинет', monthSom: 1500 },
      tariffs: { pilotMonths: 3, tariffs: [{ code: 'SMALL', name: 'Кабинет', who: '1–2 врача', monthSom: 1500, yearSom: 15000 }] },
      payments: [{ id: 1, paidOn: '2026-11-01', amountSom: 1500, months: 1, paidUntil: '2026-12-01' }],
    } satisfies Schemas['ClinicPaymentsPlan'])),
    http.get('*/api/clinic/pay', () => HttpResponse.json({
      settings: { details: 'MBank 0555 000 000', hasQr: false, hasRequisites: false },
      periods: [{ months: 1, amountSom: 1500 }, { months: 3, amountSom: 4500 }],
    } satisfies Schemas['PayRequestsClinicView'])),
    http.post('*/api/clinic/pay/requests', ({ request }) => {
      paid = new URL(request.url).searchParams.get('months')
      return HttpResponse.json({ id: 5, months: 3, amountSom: 4500, status: 'PENDING' } satisfies Schemas['PayRequestsRequest'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Приложение: оплачено до 1 дек 2026' })).toBeInTheDocument()
  expect(screen.getByText('ваш тариф')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '3 месяца' }))
  expect(screen.getByText(/К оплате: 4\s500 сом/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Я оплатил(а)' }))
  await vi.waitFor(() => expect(paid).toBe('3'))
  expect(screen.getByRole('table', { name: 'Оплаты' })).toBeInTheDocument()
})

test('договор: реквизиты подставляются в текст, подписать', async () => {
  let accepted: Schemas['AgreementControllerAccept'] | null = null
  const agreement: Schemas['AgreementsClinicAgreement'] = {
    current: { id: 1, version: 2, title: 'Договор-оферта', body: '# Стороны\nКлиника {{clinic.name}} в лице {{signer.name}}', sha256: 'abc123' },
    legalName: 'ИП Тест', scans: [],
  }
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/plan', () => HttpResponse.json({})),
    http.get('*/api/clinic/pay', () => HttpResponse.json({})),
    http.get('*/api/clinic/agreement', () => HttpResponse.json(agreement)),
    http.post('*/api/clinic/agreement/accept', async ({ request }) => {
      accepted = await request.json() as Schemas['AgreementControllerAccept']
      return HttpResponse.json({ ...agreement, accepted: { version: 2, signerName: accepted.signerName, clinicLegalName: 'ИП Тест', acceptedAt: '2026-10-31T05:00:00Z' } })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('agreement')
  expect(await screen.findByText('Клиника ИП Тест в лице ________________')).toBeInTheDocument()
  const form = screen.getByRole('form', { name: 'Подписать договор' })
  await user.type(within(form).getByRole('textbox', { name: 'ФИО подписанта' }), 'Садыкова А.')
  expect(screen.getByText('Клиника ИП Тест в лице Садыкова А.')).toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'директора' }))
  await user.click(within(form).getByRole('checkbox', { name: /вправе подписать/ }))
  await user.click(within(form).getByRole('button', { name: 'Подписать договор' }))
  expect(await screen.findByRole('heading', { name: 'Договор подписан' })).toBeInTheDocument()
  expect(accepted).toMatchObject({ sha256: 'abc123', confirm: true, clinicName: 'ИП Тест', signerName: 'Садыкова А.', signerPosition: 'директора' })
})

test('врач: только поддержка и конфиденциальность; новое обращение — текст в теле формы', async () => {
  let sent: FormData | null = null
  let url = ''
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/clinic', () => HttpResponse.json({ supportPhone: '996555000111' })),
    http.get('*/api/support/tickets', () => HttpResponse.json([])),
    http.post('*/api/support/tickets', async ({ request }) => {
      url = request.url
      sent = await request.formData()
      return HttpResponse.json({ ticket: { id: 7, kind: 'IDEA', status: 'OPEN' }, messages: [{ id: 1, author: 'Айгерим', text: 'Сделайте тёмную тему' }] })
    }),
    http.get('*/api/support/tickets/7', () => HttpResponse.json({ ticket: { id: 7, kind: 'IDEA', status: 'OPEN' }, messages: [{ id: 1, author: 'Айгерим', text: 'Сделайте тёмную тему' }] })),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('support')
  expect(await screen.findByRole('heading', { name: 'Техподдержка' })).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'Позвонить: +996 555 000 111' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Предложить идею' }))
  const panel = screen.getByRole('complementary', { name: 'Предложить идею' })
  await user.type(within(panel).getByRole('textbox'), 'Сделайте тёмную тему')
  await user.click(within(panel).getByRole('button', { name: 'Отправить' }))
  const thread = await screen.findByRole('complementary', { name: 'Обращение' })
  expect(await within(thread).findByText('Сделайте тёмную тему')).toBeInTheDocument()
  expect(url).not.toContain('text=')
  expect(sent!.get('kind')).toBe('IDEA')
  expect(sent!.get('text')).toBe('Сделайте тёмную тему')
})

test('«Данные» (владелец Tish): под выгрузкой — «Удалить все записи»; у работающей клиники — текст сервера (has-records)', async () => {
  let cleared: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, owner: true })),
    http.get('*/api/clinic/audit', () => HttpResponse.json([])),
    http.post('*/api/appointments/delete-all', async ({ request }) => {
      cleared = await request.json()
      return HttpResponse.json({ deleted: 3 } satisfies Schemas['AppointmentControllerDeleted'])
    }),
  )
  window.location.hash = '/settings/data'
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('button', { name: 'Прислать архив в бот' })).toBeInTheDocument()
  expect(screen.getByRole('note')).toHaveTextContent('Только пока клиника не начала работать')
  await user.type(screen.getByRole('textbox', { name: 'Впишите УДАЛИТЬ' }), 'УДАЛИТЬ')
  await user.click(screen.getByRole('button', { name: 'Удалить все записи' }))
  expect(await screen.findByText('Удалено записей: 3')).toBeInTheDocument()
  expect(cleared).toEqual({ confirm: 'УДАЛИТЬ' })

  server.use(http.post('*/api/appointments/delete-all', () => HttpResponse.json({
    status: 409, code: 'has-records', detail: 'В клинике уже есть состоявшиеся приёмы, заметки или оплаты — их не удалить.',
  }, { status: 409 })))
  await user.type(screen.getByRole('textbox', { name: 'Впишите УДАЛИТЬ' }), 'УДАЛИТЬ')
  await user.click(screen.getByRole('button', { name: 'Удалить все записи' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('уже есть состоявшиеся приёмы')
})

test('«Конфиденциальность»: в журнале платформы — входы и «выгрузил данные»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/platform-info', () => HttpResponse.json({ accessLog: true } satisfies Schemas['PlatformInfoInfo'])),
    http.get('*/api/clinic/support-access', () => HttpResponse.json({ required: false })),
    http.get('*/api/clinic/platform-access', () => HttpResponse.json([
      { role: 'EXPORT', enteredAt: '2026-11-01T05:00:00Z' }, { role: 'ADMIN', enteredAt: '2026-10-30T05:00:00Z' },
    ] satisfies Schemas['PlatformAccessLogEntry'][])),
  )
  window.location.hash = '/settings/privacy'
  renderApp()
  const table = await screen.findByRole('table', { name: 'Входы платформы' })
  expect(within(table).getAllByRole('row').map((r) => r.querySelector('td')?.textContent)).toEqual(['выгрузил данные', 'вошёл как админ'])
})
