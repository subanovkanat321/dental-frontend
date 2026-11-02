import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Appointment = Schemas['AppointmentView']

const visit: Appointment = appointment(10, 1, '00:05', 'Бакыт М.', { status: 'DONE', version: 1, serviceName: 'Пломба' })

function backend(draft: Schemas['VisitReportsDraft']) {
  const calls: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', ({ request }) => HttpResponse.json(
      Number(new URL(request.url).searchParams.get('doctorId')) === 1 ? [visit] : [])),
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
      return HttpResponse.json({ text: '🦷 Отчёт о приёме\n\nТекст', telegram: false })
    }),
  )
  return calls
}

beforeEach(() => {
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

test('отчёт пациенту: черновик по шаблону, правка, отправка в WhatsApp; админ может включить ИИ', async () => {
  const calls = backend({ text: 'Здравствуйте, Бакыт М.!\n\nСегодня…', ai: false, aiAvailable: true, lang: 'RU', telegram: false })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const box = await screen.findByRole('region', { name: 'Отчёт пациенту' })
  await userEvent.click(within(box).getByRole('button', { name: 'Составить отчёт' }))
  const text = await within(box).findByRole('textbox', { name: 'Текст отчёта' })
  expect(text).toHaveValue('Здравствуйте, Бакыт М.!\n\nСегодня…')
  expect(box).toHaveTextContent('По шаблону')
  expect(within(box).queryByRole('button', { name: /Отправить в Telegram/ })).not.toBeInTheDocument()
  await userEvent.type(text, ' Ждём через неделю.')
  await userEvent.click(within(box).getByRole('button', { name: 'WhatsApp' }))
  expect(await within(box).findByRole('status')).toHaveTextContent('Отчёт отправлен в WhatsApp')
  expect(calls).toContainEqual({ text: 'Здравствуйте, Бакыт М.!\n\nСегодня… Ждём через неделю.', ai: false, via: 'WHATSAPP' })
  expect(window.open).toHaveBeenCalled()

  // ИИ на сервере есть, клиника не включила — админу кнопка «Включить», после неё черновик заново
  await userEvent.click(within(box).getByRole('button', { name: 'Включить ИИ для отчётов клиники' }))
  await vi.waitFor(() => expect(calls).toContainEqual({ on: true }))
  await vi.waitFor(() => expect(calls.filter((c) => c === 'draft')).toHaveLength(2))
})

test('отчёт пациенту: ИИ написал на кыргызском, пациент в Telegram — «Отправить в Telegram»', async () => {
  const calls = backend({ text: 'Саламатсызбы!', ai: true, aiAvailable: true, lang: 'KY', telegram: true })
  renderApp()
  await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
  const box = await screen.findByRole('region', { name: 'Отчёт пациенту' })
  await userEvent.click(within(box).getByRole('button', { name: 'Составить отчёт' }))
  expect(await within(box).findByText(/Написал ИИ/)).toHaveTextContent('на кыргызском')
  await userEvent.click(within(box).getByRole('button', { name: '📤 Отправить в Telegram' }))
  expect(await within(box).findByRole('status')).toHaveTextContent('Отчёт отправлен в Telegram')
  expect(calls).toContainEqual({ text: 'Саламатсызбы!', ai: true, via: 'TELEGRAM' })
})
