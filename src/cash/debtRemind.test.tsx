import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, findSub, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// «Напомнить о долге» и «Обещал оплатить до…» (V219 бэкенда). Пациенты и суммы — вымышленные

type Debt = Schemas['PaymentQueryDebt']

afterEach(() => {
  window.location.hash = ''
})

const debt = (appointmentId: number, patientId: number, patient: string, extra: Partial<Debt> = {}): Debt => ({
  appointmentId, patientId, patient, doctorId: 1, doctor: 'Айгерим', startAt: '2026-10-01T04:00:00Z', chargeSom: 5000, paidSom: 0, debtSom: 5000, ...extra,
})

const draft = (extra: Partial<Schemas['DebtRemindersDraft']> = {}): Schemas['DebtRemindersDraft'] => ({
  text: '💳 Напоминание об оплате\n\nЗдравствуйте! Напоминаем об оплате за лечение в «Тест»: 5 000 сом.\nОплатить можно в клинике.',
  debtSom: 5000, telegram: true, phone: '996555000111', lang: 'RU', ...extra,
})

test('«Должники» → «Напомнить»: текст с сервера, в Telegram — отметка «напомнили»', async () => {
  let reminded: string | undefined
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([debt(1, 5, 'Айгуль Вымышленная', { remindedAt: reminded })])),
    http.get('*/api/patients/5/debt-reminder', () => HttpResponse.json(draft())),
    http.post('*/api/patients/5/debt-reminder', async ({ request }) => {
      sent.push(await request.json())
      reminded = new Date().toISOString()
      return HttpResponse.json({ channel: 'TELEGRAM', remindedAt: reminded } satisfies Schemas['DebtRemindersSent'])
    }),
  )
  window.location.hash = '/cash'
  renderApp()
  await userEvent.click(await findSub('Должники'))
  const box = await screen.findByRole('region', { name: 'Должники' })
  const row = within(box).getByRole('listitem')
  await userEvent.click(within(row).getByRole('button', { name: 'Напомнить' }))
  const form = await within(row).findByRole('form', { name: 'Напоминание о долге: Айгуль Вымышленная' })
  expect(form).toHaveTextContent(/5\s000 сом/)
  // Текст не правят: сумма — только с сервера
  expect(within(form).queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.click(within(form).getByRole('button', { name: '📤 В Telegram' }))
  expect(await within(row).findByRole('status')).toHaveTextContent('Напоминание отправлено в Telegram')
  expect(sent).toEqual([{ channel: 'TELEGRAM' }])
  await userEvent.click(within(row).getByRole('button', { name: 'Готово' }))
  expect(await within(row).findByText(/напомнили/)).toBeInTheDocument()
})

test('«Напомнить»: напоминали вчера — когда снова можно, кнопок отправки нет; без бота — WhatsApp', async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString()
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([
      debt(1, 5, 'Айгуль Вымышленная', { remindedAt: yesterday }),
      debt(2, 6, 'Бакыт Вымышленный', { debtSom: 1000, chargeSom: 1000 }),
    ])),
    http.get('*/api/patients/5/debt-reminder', () => HttpResponse.json(draft({ remindedAt: yesterday, nextAt: addDays(todayIn(), 2) + 'T04:00:00Z' }))),
    http.get('*/api/patients/6/debt-reminder', () => HttpResponse.json(draft({ telegram: false, debtSom: 1000, text: 'Здравствуйте! 1 000 сом.' }))),
    http.post('*/api/patients/6/debt-reminder', () => HttpResponse.json({ channel: 'WHATSAPP', text: 'Здравствуйте! 1 000 сом.', remindedAt: new Date().toISOString() } satisfies Schemas['DebtRemindersSent'])),
  )
  window.location.hash = '/cash'
  renderApp()
  await userEvent.click(await findSub('Должники'))
  const box = await screen.findByRole('region', { name: 'Должники' })
  const [first, second] = within(box).getAllByRole('listitem')
  expect(first).toHaveTextContent('напомнили')
  await userEvent.click(within(first!).getByRole('button', { name: 'Напомнить' }))
  expect(await within(first!).findByRole('status')).toHaveTextContent(/Уже напоминали .* снова можно с/)
  expect(within(first!).queryByRole('button', { name: '📤 В Telegram' })).not.toBeInTheDocument()
  expect(within(first!).queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument()

  await userEvent.click(within(second!).getByRole('button', { name: 'Напомнить' }))
  await userEvent.click(await within(second!).findByRole('button', { name: 'WhatsApp' }))
  expect(await within(second!).findByRole('status')).toHaveTextContent('Открыли WhatsApp')
  expect(opened.join(' ')).toContain('996555000111')
})

test('«⋯ → Обещал оплатить до…»: дата уходит на сервер, в строке — «оплатит до», просрочено — красным', async () => {
  const due = addDays(todayIn(), 5)
  let saved: string | undefined
  const bodies: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments/debts', () => HttpResponse.json([
      debt(1, 5, 'Айгуль Вымышленная', { dueOn: saved }),
      debt(2, 6, 'Бакыт Вымышленный', { dueOn: '2020-01-01', debtSom: 9000 }),
    ])),
    http.put('*/api/patients/5/debt-due', async ({ request }) => {
      const body = await request.json() as { dueOn?: string }
      bodies.push(body)
      saved = body.dueOn
      return HttpResponse.json([debt(1, 5, 'Айгуль Вымышленная', { dueOn: saved })])
    }),
  )
  window.location.hash = '/cash'
  renderApp()
  await userEvent.click(await findSub('Должники'))
  const box = await screen.findByRole('region', { name: 'Должники' })
  const overdue = within(box).getAllByRole('listitem')[0]!
  expect(within(overdue).getByText(/обещал до/)).toHaveClass('tone-bad')

  const row = within(box).getAllByRole('listitem')[1]!
  await userEvent.click(within(row).getByRole('button', { name: 'Ещё: Айгуль Вымышленная' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Обещал оплатить до…' }))
  const form = within(row).getByRole('form', { name: 'Обещал оплатить до' })
  const input = within(form).getByLabelText('Обещал оплатить до')
  await userEvent.clear(input)
  await userEvent.type(input, due)
  await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(box).findByText(/оплатит до/)).toBeInTheDocument()
  expect(bodies).toEqual([{ dueOn: due }])
})

test('карточка приёма: пациент с долгом записан — «Долг 5 000»; «Приём состоялся» — подсказка напомнить при оплате', async () => {
  let current = appointment(10, 1, '00:05', 'Айгуль Вымышленная', { version: 1 })
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [current] : [])),
    http.get('*/api/appointments/debts', () => HttpResponse.json([debt(3, 10, 'Айгуль Вымышленная')])),
    http.post('*/api/appointments/:id/status', async ({ request }) => {
      const body = await request.json() as { status: Schemas['AppointmentView']['status'] }
      current = { ...current, status: body.status, version: current.version + 1 }
      return HttpResponse.json(current)
    }),
  )
  renderApp()
  // В расписании — значок долга пациента
  expect(await screen.findByRole('img', { name: /Долг пациента 5\s000 сом/ })).toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: /Айгуль Вымышленная/ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(await within(panel).findByText(/Долг 5\s000 сом/)).toBeInTheDocument()
  await userEvent.click(within(panel).getByRole('button', { name: 'Приём состоялся' }))
  expect(await within(panel).findByText(/У пациента долг 5\s000 сом за прошлые визиты — напомните при оплате/)).toBeInTheDocument()
})

test('регистратура «Должников» не видит — меток долга и запроса долгов нет', async () => {
  let asked = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined, hasReception: true })),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1'
      ? [appointment(10, 1, '00:05', 'Айгуль Вымышленная')] : [])),
    http.get('*/api/appointments/debts', () => {
      asked++
      return HttpResponse.json([debt(3, 10, 'Айгуль Вымышленная')])
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Айгуль Вымышленная/ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  expect(within(panel).queryByText(/Долг 5\s000/)).not.toBeInTheDocument()
  expect(asked).toBe(0)
})

test('«Настройки → Напоминание о долге»: стандартный текст, реквизиты в предпросмотре, свой текст — на сервер', async () => {
  const saved: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/settings', () => HttpResponse.json({
      clinicSignature: 'Стоматология «Тест»', clinicName: 'Стоматология «Тест»', paymentDetails: 'Мбанк 0555 000 111 (Тест)',
    } satisfies Schemas['SettingsControllerSettings'])),
    http.put('*/api/clinic/debt-template', async ({ request }) => {
      const body = await request.json() as Schemas['ClinicControllerDebtTemplate']
      saved.push(body)
      return HttpResponse.json(body)
    }),
  )
  renderApp()
  openItem('debt')
  const field = await screen.findByRole('textbox', { name: 'Текст напоминания' }) as HTMLTextAreaElement
  expect(field.value).toContain('{сумма}')
  const preview = screen.getByRole('figure', { name: 'Сообщение пациенту' })
  expect(preview).toHaveTextContent('«Стоматология «Тест»»: 5 000 сом.')
  expect(preview).toHaveTextContent('Оплатить можно в клинике или переводом: Мбанк 0555 000 111 (Тест)')
  await userEvent.clear(field)
  await userEvent.type(field, 'Добрый день! За лечение — {{сумма}.')
  expect(screen.getByRole('figure', { name: 'Сообщение пациенту' })).toHaveTextContent('За лечение — 5 000 сом.')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByText('Текст напоминания о долге сохранён')
  expect(saved).toEqual([{ debtTemplate: 'Добрый день! За лечение — {сумма}.' }])
})
