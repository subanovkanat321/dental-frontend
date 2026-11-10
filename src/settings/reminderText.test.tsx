import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, openItem, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Settings = Schemas['SettingsControllerSettings']
type Templates = Schemas['ClinicControllerReminderRequest']

const SETTINGS: Settings = {
  clinicSignature: 'Стоматология «Тест»', botUrl: 'https://t.me/test_bot?start=c_test', clinicName: 'Стоматология «Тест»',
  clinicAddress: 'Бишкек, ул. Тестовая 1', clinicPhone: '+996 555 000 000',
}

function backend(settings: Settings = SETTINGS, who: Schemas['BookingViewsMe'] = me) {
  const saved: Templates[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/settings', () => HttpResponse.json(settings)),
    http.put('*/api/clinic/reminder-template', async ({ request }) => {
      const body = (await request.json()) as Templates
      saved.push(body)
      return HttpResponse.json({ ru: body.reminderTemplate, ky: body.reminderTemplateKy } satisfies Schemas['ClinicServiceReminderTemplates'])
    }),
  )
  return saved
}

afterEach(() => { window.location.hash = '' })

test('«Текст напоминания»: стандартный текст, вставка переменной в курсор, предпросмотр Telegram и WhatsApp, сохранение', async () => {
  const saved = backend()
  renderApp()
  openItem('reminder')
  const field = await screen.findByRole('textbox', { name: 'Текст по-русски' }) as HTMLTextAreaElement
  expect(field.value).toBe('Здравствуйте, {имя}! 👋 Напоминаем: {когда} приём у стоматолога 🦷')
  const telegram = screen.getByRole('figure', { name: 'Telegram' })
  // Стандартный текст бота — с «Нажмите кнопку ниже» и адресом с подписью
  expect(telegram).toHaveTextContent('Здравствуйте, Айгуль! 👋 Напоминаем: завтра в 10:00 приём у стоматолога 🦷 Нажмите кнопку ниже')
  expect(telegram).toHaveTextContent('📍 Адрес: Бишкек, ул. Тестовая 1')
  expect(telegram).toHaveTextContent('👍 Приду')

  await userEvent.clear(field)
  await userEvent.type(field, 'Ждём вас  у врача {{врач}.')
  // Курсор между «вас» и «у»: вставка {когда} туда
  field.setSelectionRange(9, 9)
  await userEvent.click(within(screen.getByRole('group', { name: 'Вставить переменную' })).getByRole('button', { name: '{когда}' }))
  expect(field.value).toBe('Ждём вас {когда} у врача {врач}.')
  expect(telegram).toHaveTextContent('Ждём вас завтра в 10:00 у врача Айгерим Садыкова.')
  const whatsapp = screen.getByRole('figure', { name: 'WhatsApp и SMS' })
  expect(whatsapp).toHaveTextContent('Ответьте 1 — приду, 2 — перенести.')
  expect(whatsapp).toHaveTextContent('https://t.me/test_bot?start=c_test')
  expect(telegram).not.toHaveTextContent('t.me')

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Текст напоминания сохранён')).toBeInTheDocument()
  expect(saved).toEqual([{ reminderTemplate: 'Ждём вас {когда} у врача {врач}.' }])
})

test('неизвестная переменная — ошибка и сохранить нельзя; без {когда} — предупреждение', async () => {
  backend({ ...SETTINGS, reminderTemplate: 'Ждём {когда}' })
  renderApp()
  openItem('reminder')
  const field = await screen.findByRole('textbox', { name: 'Текст по-русски' })
  await userEvent.clear(field)
  await userEvent.type(field, 'Привет, {{name}!')
  expect(screen.getByRole('alert')).toHaveTextContent('Неизвестная переменная {name}')
  expect(field).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  expect(screen.getByText(/пациент не узнает, когда приём/)).toBeInTheDocument()
})

test('«Вернуть стандартный текст» — сохраняется пусто; кыргызский пустой — уйдёт русский текст клиники', async () => {
  const saved = backend({ ...SETTINGS, reminderTemplate: 'Ждём {когда}' })
  renderApp()
  openItem('reminder')
  await userEvent.click(await screen.findByRole('button', { name: 'Кыргызский' }))
  expect(screen.getByRole('textbox', { name: 'Текст по-кыргызски' })).toHaveValue('')
  expect(screen.getByText('Кыргызоязычным пациентам уйдёт русский текст клиники.')).toBeInTheDocument()
  // Пусто по-кыргызски — бот шлёт русский текст клиники, и {когда} по-русски
  expect(screen.getByRole('figure', { name: 'Telegram' })).toHaveTextContent('Ждём завтра в 10:00')
  expect(screen.getByRole('figure', { name: 'Telegram' })).toHaveTextContent('👍 Келем')

  await userEvent.click(screen.getByRole('button', { name: 'Русский' }))
  await userEvent.click(screen.getByRole('button', { name: 'Вернуть стандартный текст' }))
  expect(screen.getByRole('textbox', { name: 'Текст по-русски' })).toHaveValue('Здравствуйте, {имя}! 👋 Напоминаем: {когда} приём у стоматолога 🦷')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Текст напоминания сохранён')).toBeInTheDocument()
  expect(saved).toEqual([{}])
})

test('не админ пункта не видит', async () => {
  backend(SETTINGS, { ...me, admin: false })
  renderApp()
  openItem('')
  expect(await screen.findByRole('button', { name: /Памятки после процедур/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Текст напоминания/ })).not.toBeInTheDocument()
})
