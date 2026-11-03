import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

function backend(start: Appointment) {
  let a = { ...start }
  const calls: string[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
    http.post('*/api/appointments/:id/remind-telegram', () => {
      calls.push('telegram')
      a = { ...a, reminderOpenedAt: new Date().toISOString(), version: a.version! + 1 }
      return HttpResponse.json(a)
    }),
    http.post('*/api/appointments/:id/reminder-opened', () => {
      calls.push('opened')
      a = { ...a, reminderOpenedAt: new Date().toISOString() }
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/api/appointments/:id/reply', async ({ request }) => {
      const body = (await request.json()) as { reply: Appointment['reply']; version: number }
      calls.push(`reply:${body.reply}:v${body.version}`)
      a = { ...a, reply: body.reply, version: a.version! + 1 }
      return HttpResponse.json(a)
    }),
  )
  return calls
}

test('напомнить в Telegram (пациент записан через бота) — сервер шлёт, статус «Ждём ответа»', async () => {
  const calls = backend(appointment(10, 1, '23:30', 'Бакыт М.', { patient: { id: 10, fullName: 'Бакыт М.', phone: '996555123456', telegram: true } }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Напомнить в Telegram' }))
  expect(await within(panel).findByText('Ждём ответа')).toBeInTheDocument()
  expect(calls).toEqual(['telegram'])
})

test('напомнить в WhatsApp — текст с подписью клиники; ответ «Придёт», повторно — снять', async () => {
  const calls = backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Напомнить в WhatsApp' }))
  expect(decodeURIComponent(opened[0]!)).toContain('Ответьте 1 — приду, 2 — перенести')
  expect(decodeURIComponent(opened[0]!)).toContain('Стоматология «Тест»')

  const replies = within(panel).getByRole('group', { name: 'Ответ пациента' })
  await userEvent.click(within(replies).getByRole('button', { name: 'Придёт' }))
  expect(await within(replies).findByRole('button', { name: 'Придёт', pressed: true })).toBeInTheDocument()
  await userEvent.click(within(replies).getByRole('button', { name: 'Придёт' }))
  await vi.waitFor(() => expect(calls).toEqual(['opened', 'reply:CONFIRMED:v0', 'reply:NONE:v1']))
  vi.restoreAllMocks()
})

test('заметка о приёме у прошедшего приёма — сохранить', async () => {
  backend(appointment(10, 1, '00:00', 'Бакыт М.', { status: 'DONE', paidSom: 1000, paymentMethod: 'CASH' }))
  let saved: unknown
  server.use(
    http.get('*/api/appointments/10/note', () => HttpResponse.json({ note: '' })),
    http.put('*/api/appointments/10/note', async ({ request }) => {
      const body = (await request.json()) as { note: string }
      saved = body
      return HttpResponse.json(body)
    }),
  )
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.type(await within(panel).findByRole('textbox', { name: /Заметка о приёме/ }), 'Пломба 36, контроль через полгода')
  await userEvent.click(within(panel).getByRole('button', { name: 'Сохранить заметку' }))
  expect(await within(panel).findByText('Сохранено')).toBeInTheDocument()
  expect(saved).toEqual({ note: 'Пломба 36, контроль через полгода' })
})

test('карточка приёма: «Откуда узнал» — пациент не ответил в боте, врач отмечает прямо в приёме', async () => {
  backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  let saved: Record<string, unknown> | null = null
  server.use(http.put('*/api/patients/:id', async ({ request }) => {
    saved = await request.json() as Record<string, unknown>
    return HttpResponse.json({ id: 10, fullName: 'Бакыт М.', phone: '996555123456', sourceId: saved.sourceId as number })
  }))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  const source = await within(panel).findByRole('group', { name: 'Откуда узнал о клинике' })
  // В приёме варианты свёрнуты, чтобы не сдвигать кнопки приёма: «выбрать» — раскрыть
  await userEvent.click(within(source).getByRole('button', { name: 'выбрать' }))
  await userEvent.click(within(source).getByRole('button', { name: '📱 Instagram' }))
  await vi.waitFor(() => expect(saved).toMatchObject({ fullName: 'Бакыт М.', sourceId: expect.any(Number) }))
})

test('телефон: «Напомнить по SMS» — «Сообщения» с номером пациента, текстом напоминания и ссылкой на бота', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')
  const calls = backend(appointment(10, 1, '23:30', 'Бакыт М.'))
  server.use(http.get('*/api/settings', () => HttpResponse.json({ clinicSignature: 'Стоматология «Тест»', botUrl: 'https://t.me/test_bot?start=c_test' })))
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  const sms = await within(panel).findByRole('link', { name: 'Напомнить по SMS' })
  const href = sms.getAttribute('href')!
  expect(href.startsWith('sms:+996555123456?&body=')).toBe(true)
  expect(decodeURIComponent(href)).toContain('Здравствуйте, Бакыт М.!')
  expect(decodeURIComponent(href)).toContain('в Telegram: https://t.me/test_bot?start=c_test')
  sms.addEventListener('click', (e) => e.preventDefault())
  await userEvent.click(sms)
  await vi.waitFor(() => expect(calls).toContain('opened'))
  vi.restoreAllMocks()
})

test('свой текст напоминания клиники — в WhatsApp: врач и услуга приёма, «Ответьте 1…», ссылка на бота', async () => {
  backend(appointment(10, 1, '23:30', 'Бакыт М.', { serviceName: 'Чистка' }))
  server.use(http.get('*/api/settings', () => HttpResponse.json({
    clinicSignature: 'Стоматология «Тест»', botUrl: 'https://t.me/test_bot?start=c_test', clinicName: 'Стоматология «Тест»',
    reminderTemplate: '{имя}, ждём вас {когда}: {врач}, {услуга}. {клиника}',
  } satisfies Schemas['SettingsControllerSettings'])))
  const opened: string[] = []
  vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: 'Напомнить в WhatsApp' }))
  const text = decodeURIComponent(opened[0]!)
  expect(text).toMatch(/Бакыт М\., ждём вас (сегодня|завтра) в 23:30: Айгерим Садыкова, Чистка\. Стоматология «Тест»\nОтветьте 1 — приду, 2 — перенести\./)
  // {клиника} в тексте — подпись второй раз не ставим
  expect(text.split('Стоматология «Тест»')).toHaveLength(2)
  expect(text).toContain('📲 Записываться самим и получать напоминания можно в Telegram: https://t.me/test_bot?start=c_test')
  vi.restoreAllMocks()
})
