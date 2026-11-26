import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { kindText, markText, statusText, templateStatusText } from '../lib/whatsapp'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type View = Schemas['WhatsAppAdminClinicView']

const connected: View = {
  available: true, connected: true, displayPhone: '+996 555 900 900', confirmation: true, reminder: true, soon: true,
  templates: [
    { name: 'appointment_confirmation', kind: 'CONFIRMATION', lang: 'ru', status: 'APPROVED' },
    { name: 'appointment_reminder', kind: 'REMINDER', lang: 'ru', status: 'APPROVED' },
    { name: 'appointment_reminder', kind: 'REMINDER', lang: 'ky_KG', status: 'REJECTED', reason: 'INVALID_FORMAT' },
    { name: 'appointment_soon', kind: 'SOON', lang: 'ru', status: 'PENDING' },
  ],
  recent: [
    { id: 3, createdAt: '2026-11-24T12:00:00Z', kind: 'REMINDER', status: 'READ', appointmentId: 10 },
    { id: 2, createdAt: '2026-11-24T11:00:00Z', kind: 'CONFIRMATION', status: 'FAILED', errorCode: 131026, appointmentId: 11 },
  ],
}

function backend(view: View) {
  const puts: unknown[] = []
  let submits = 0
  let state = view
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/clinic/whatsapp', () => HttpResponse.json(state)),
    http.put('*/api/clinic/whatsapp', async ({ request }) => {
      const body = (await request.json()) as Schemas['WhatsAppControllerKinds']
      puts.push(body)
      state = { ...state, confirmation: body.confirmation ?? true, reminder: body.reminder ?? true, soon: body.soon ?? true }
      return HttpResponse.json(state)
    }),
    http.post('*/api/clinic/whatsapp/templates', () => {
      submits++
      return HttpResponse.json(state)
    }),
  )
  return { puts, submits: () => submits }
}

afterEach(() => { window.location.hash = '' })

test('«Настройки → Сообщения пациентам → WhatsApp» не подключён: что это и «Подключение — через владельца Tish»', async () => {
  backend({ available: false, connected: false, confirmation: true, reminder: true, soon: true, templates: [], recent: [] })
  renderApp()
  openItem('whatsapp')
  const box = await screen.findByRole('region', { name: 'Не подключён' })
  expect(box).toHaveTextContent('Подключение — через владельца Tish')
  expect(box).toHaveTextContent('«Приду / Перенести / Отменить»')
  expect(screen.queryByRole('region', { name: 'Что отправлять' })).not.toBeInTheDocument()
})

test('«Настройки → Сообщения пациентам → WhatsApp» подключён: номер, галочки, статусы шаблонов, последние сообщения без имён и номеров', async () => {
  const { puts, submits } = backend(connected)
  renderApp()
  openItem('whatsapp')
  expect(await screen.findByRole('region', { name: 'Подключение' })).toHaveTextContent('+996 555 900 900')

  const kinds = screen.getByRole('region', { name: 'Что отправлять' })
  const soon = within(kinds).getByRole('checkbox', { name: /За 2 часа/ })
  expect(soon).toBeChecked()
  await userEvent.click(soon)
  await waitForSlow(() => expect(puts).toEqual([{ confirmation: true, reminder: true, soon: false }]))
  await waitForSlow(() => expect(within(kinds).getByRole('checkbox', { name: /За 2 часа/ })).not.toBeChecked())

  const templates = screen.getByRole('region', { name: 'Шаблоны' })
  const reminderRow = within(templates).getByRole('row', { name: /Напоминание накануне/ })
  expect(reminderRow).toHaveTextContent('утверждён')
  expect(reminderRow).toHaveTextContent('отклонён')
  expect(within(templates).getByRole('row', { name: /За 2 часа/ })).toHaveTextContent('на проверке')
  await userEvent.click(within(templates).getByRole('button', { name: 'Отправить шаблоны на проверку' }))
  await waitForSlow(() => expect(submits()).toBe(1))

  const recent = screen.getByRole('region', { name: 'Последние сообщения' })
  expect(recent).toHaveTextContent('прочитано')
  expect(recent).toHaveTextContent('не доставлено · код 131026')
  expect(recent).not.toHaveTextContent('996')
})

test('подписи статусов WhatsApp', () => {
  expect(markText({ kind: 'REMINDER', status: 'DELIVERED' })).toBe('📲 WhatsApp: доставлено')
  expect(markText({ kind: 'SOON', status: 'READ' })).toBe('📲 WhatsApp: прочитано')
  expect(markText({ kind: 'REMINDER', status: 'FAILED' })).toBe('📲 WhatsApp: не доставлено')
  expect(markText(undefined)).toBeNull()
  expect(statusText('QUEUED')).toBe('отправляется')
  expect(kindText('CONFIRMATION')).toBe('Вы записаны')
  expect(templateStatusText(undefined)).toBe('не отправлен')
})
