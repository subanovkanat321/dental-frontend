import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp, openMore } from '../test/fixtures'
import { server } from '../test/server'
import { choose } from '../test/select'
import { waitForSlow } from '../test/wait'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

/** Вымышленный пациент; квитанция и памятка — как их отдаёт сервер. */
const RECEIPT = {
  appointmentId: 10, startAt: '2026-10-20T04:00:00Z', doctor: 'Айгерим Садыкова', patient: 'Бакыт М.', service: 'Удаление зуба',
  chargeSom: 5000, paidSom: 3000, debtSom: 2000,
  payments: [
    { paidAt: '2026-10-20T04:30:00Z', amountSom: 2000, method: 'CASH', takenBy: 'Жылдыз' },
    { paidAt: '2026-10-23T04:30:00Z', amountSom: 1000, method: 'TRANSFER' },
  ],
  text: '🧾 Квитанция об оплате\n\nОплачено: 3 000 сом\nНе является фискальным чеком.', telegram: false,
} satisfies Schemas['ReceiptsReceiptView']

const MEMO = {
  memoId: 3, title: 'После удаления зуба', body: '• Держите тампон 20–30 минут.\n\nЗвоните в клинику: +996 555 000 000.',
  text: '📋 Памятка после приёма\n\nПосле удаления зуба', telegram: true,
} satisfies Schemas['CareMemosAppointmentMemo']

/** Регистратура: личного «Сообщения после приёма» нет (сервер — 403), памятка на карточке — как раньше. */
const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined, fullName: 'Жылдыз' }

function backend(a: Appointment, who: Me = me, memo: Schemas['CareMemosAppointmentMemo'] = MEMO) {
  const sent: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === a.doctorId ? [a] : [])),
    http.get('*/api/appointments/:id/care-memo', ({ request }) => {
      const chosen = new URL(request.url).searchParams.get('memoId')
      return HttpResponse.json(chosen ? { ...memo, memoId: Number(chosen), title: 'После чистки' } : memo)
    }),
    http.get('*/api/care-memos', () => HttpResponse.json([
      { id: 3, title: 'После удаления зуба', active: true }, { id: 4, title: 'После чистки', active: true },
    ] satisfies Schemas['CareMemosCareMemoView'][])),
    http.get('*/api/appointments/:id/visit-report', () => who === me ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json({ status: 403, detail: 'Нет доступа' }, { status: 403 })),
    http.get('*/api/appointments/:id/receipt', () => {
      sent.push('receipt')
      return HttpResponse.json(RECEIPT)
    }),
    http.post('*/api/appointments/:id/care-memo/send', async ({ request }) => {
      sent.push(`memo:${JSON.stringify(await request.json())}`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

async function card(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('complementary', { name: 'Карточка приёма' })
}

const done = (extra: Partial<Appointment> = {}) =>
  appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1, paidSom: 3000, chargeSom: 5000, debtSom: 2000, serviceName: 'Удаление зуба', ...extra })

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete window.Telegram
})

test('регистратура: памятка по услуге — «📤 Отправить пациенту» шлёт бот только по нажатию, личного сообщения нет', async () => {
  const sent = backend(done(), reception)
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(await within(panel).findByText('После удаления зуба')).toBeInTheDocument()
  expect(sent.filter((s) => s.startsWith('memo'))).toEqual([])

  await userEvent.click(within(panel).getByRole('button', { name: 'Отправить пациенту в Telegram: памятка «После удаления зуба»' }))
  expect(await within(panel).findByText('Отправлено в Telegram')).toBeInTheDocument()
  expect(sent).toContain('memo:{"memoId":3}')
  expect(within(panel).queryByRole('region', { name: 'Сообщение после приёма' })).not.toBeInTheDocument()

  // Другая памятка — выбрать из списка
  await userEvent.click(within(panel).getByRole('button', { name: 'другая' }))
  await choose(within(panel).getByRole('combobox', { name: 'Выбрать памятку' }), 'После чистки')
  expect(await within(panel).findByText('После чистки', { selector: 'b' })).toBeInTheDocument()
})

test('печать памятки: лист с клиникой, текстом и пациентом, окно печати браузера', async () => {
  backend(done(), reception)
  renderApp()
  const panel = await card(/Бакыт М\./)
  await userEvent.click(await within(panel).findByRole('button', { name: 'Печать: памятка «После удаления зуба»' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: Памятка пациенту' })
  expect(within(sheet).getByRole('heading', { name: 'После удаления зуба' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Стоматология «Тест»')
  expect(sheet).toHaveTextContent('Бакыт М.')
  expect(sheet).toHaveTextContent('Держите тампон 20–30 минут.')
  await waitForSlow(() => expect(window.print).toHaveBeenCalled())
  expect(document.body).toHaveClass('printing')

  await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('dialog', { name: /Печать/ })).not.toBeInTheDocument()
  expect(document.body).not.toHaveClass('printing')
  // Карточка приёма осталась
  expect(screen.getByRole('complementary', { name: 'Карточка приёма' })).toBeInTheDocument()
})

test('квитанция: платежи, кто принял, долг, «Не является фискальным чеком»; чек 80 мм; WhatsApp без Telegram', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  backend(done())
  renderApp()
  const panel = await card(/Бакыт М\./)
  await openMore(panel)
  await userEvent.click(await within(panel).findByRole('button', { name: 'Печать: квитанция' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: Квитанция об оплате' })
  const rows = within(within(sheet).getByRole('table', { name: 'Платежи' })).getAllByRole('row')
  expect(rows[1]).toHaveTextContent(/20\.10\.2026наличныеЖылдыз2\s000 сом/)
  expect(rows[2]).toHaveTextContent(/перевод—1\s000 сом/)
  expect(sheet).toHaveTextContent(/Осталось оплатить: 2\s000 сом/)
  expect(sheet).toHaveTextContent('Не является фискальным чеком')

  await userEvent.click(within(sheet).getByRole('button', { name: 'Чек 80 мм' }))
  expect(sheet.querySelector('.print-sheet')).toHaveClass('narrow')
  expect(within(sheet).getByRole('list', { name: 'Платежи' })).toHaveTextContent('принял(а) Жылдыз')
  expect(sheet.querySelector('style')?.textContent).toContain('80mm')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }))

  await userEvent.click(within(panel).getByRole('button', { name: 'Отправить пациенту в WhatsApp: квитанция' }))
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555123456&text=${encodeURIComponent(RECEIPT.text)}`, '_blank', 'noopener')
})

test('ассистент: памятка есть, квитанции нет — денег ему не показываем', async () => {
  const assistant = { ...me, admin: false, doctorId: undefined, fullName: 'Асель', assistantOf: [1] }
  const sent = backend(done({ paidSom: undefined, chargeSom: undefined, debtSom: 0 }), assistant)
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(await within(panel).findByText('После удаления зуба')).toBeInTheDocument()
  expect(within(panel).queryByText('🧾 Квитанция об оплате')).not.toBeInTheDocument()
  expect(sent).not.toContain('receipt')
})

test('в Telegram печати нет — подсказка «печать — с компьютера»', async () => {
  window.Telegram = { WebApp: { initData: 'test', ready() {}, expand() {} } }
  backend(done(), reception)
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(await within(panel).findByText('После удаления зуба')).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: /^Печать/ })).not.toBeInTheDocument()
  expect(within(panel).getAllByText('🖨 Печать — с компьютера').length).toBeGreaterThan(0)
})

test('бот не доставил — ошибка и «Отправить в WhatsApp»', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  backend(done(), reception)
  server.use(http.post('*/api/appointments/:id/care-memo/send', () => HttpResponse.json(
    { status: 409, code: 'not-delivered', detail: 'Не доставлено: пациент мог удалить чат с ботом. Отправьте в WhatsApp' }, { status: 409 })))
  renderApp()
  const panel = await card(/Бакыт М\./)
  await userEvent.click(await within(panel).findByRole('button', { name: /Отправить пациенту в Telegram: памятка/ }))
  expect(await within(panel).findByRole('alert')).toHaveTextContent('Не доставлено')
  await userEvent.click(within(panel).getByRole('button', { name: 'Отправить в WhatsApp' }))
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555123456&text=${encodeURIComponent(MEMO.text)}`, '_blank', 'noopener')
})

test('у услуги нет памятки — выбрать из списка', async () => {
  backend(done(), reception, { telegram: false })
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(await within(panel).findByText(/У услуги нет памятки/)).toBeInTheDocument()
  await choose(await within(panel).findByRole('combobox', { name: 'Выбрать памятку' }), 'После чистки')
  expect(await within(panel).findByText('После чистки', { selector: 'b' })).toBeInTheDocument()
})

test('памятка по-кыргызски: язык пациента по умолчанию, выбор языка для WhatsApp, бота и печати', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const KY = {
    memoId: 3, title: 'Тиш жулдургандан кийин', body: '• Тампонду 20–30 мүнөт кармаңыз.', text: '📋 Кабыл алуудан кийинки эскертме\n\nТиш жулдургандан кийин',
    telegram: false, lang: 'KY', patientLang: 'KY', ky: true,
  } satisfies Schemas['CareMemosAppointmentMemo']
  const RU = { ...MEMO, telegram: false, lang: 'RU', patientLang: 'KY', ky: true } satisfies Schemas['CareMemosAppointmentMemo']
  backend(done(), reception, KY)
  server.use(http.get('*/api/appointments/:id/care-memo', ({ request }) =>
    HttpResponse.json(new URL(request.url).searchParams.get('lang') === 'RU' ? RU : KY)))
  renderApp()
  const panel = await card(/Бакыт М\./)
  expect(await within(panel).findByText('Тиш жулдургандан кийин')).toBeInTheDocument()
  const langs = within(panel).getByRole('group', { name: 'Язык памятки' })
  expect(within(langs).getByRole('button', { name: 'Кыргызский · язык пациента' })).toHaveAttribute('aria-pressed', 'true')

  // Печать — сначала язык пациента, переключатель над листом
  await userEvent.click(within(panel).getByRole('button', { name: 'Печать: памятка «Тиш жулдургандан кийин»' }))
  const sheet = await screen.findByRole('dialog', { name: 'Печать: Памятка пациенту' })
  expect(within(sheet).getByRole('heading', { name: 'Тиш жулдургандан кийин' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Бейтап')
  await userEvent.click(within(within(sheet).getByRole('group', { name: 'Язык памятки' })).getByRole('button', { name: 'Русский' }))
  expect(await within(sheet).findByRole('heading', { name: 'После удаления зуба' })).toBeInTheDocument()
  expect(sheet).toHaveTextContent('Держите тампон 20–30 минут.')
  await userEvent.click(within(sheet).getByRole('button', { name: 'Закрыть' }))

  // WhatsApp — на выбранном языке
  await userEvent.click(within(langs).getByRole('button', { name: 'Русский' }))
  expect(await within(panel).findByText('После удаления зуба', { selector: 'b' })).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Отправить пациенту в WhatsApp: памятка «После удаления зуба»' }))
  expect(open).toHaveBeenCalledWith(`https://api.whatsapp.com/send/?phone=996555123456&text=${encodeURIComponent(MEMO.text)}`, '_blank', 'noopener')
})
