import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { phoneFromInput, phoneToInput } from './phone'

const clinic: Schemas['ClinicView'] = {
  brandName: 'Стоматология «Тест»', whatsappPhone: '996555123456', code: 'test1', workStart: '09:00:00', workEnd: '18:00:00',
  workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], listed: true,
}

beforeEach(() => {
  window.location.hash = '/clinic'
  server.use(
    http.get('*/api/clinic', () => HttpResponse.json(clinic)),
    http.get('*/api/clinic/deposit', () => HttpResponse.json({ mode: 'OFF', hasQr: false } satisfies Schemas['DepositsSettings'])),
    http.get('*/api/service-types', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('телефон: местный номер получает +996, полный — как есть', () => {
  expect(phoneFromInput('555 123 456')).toBe('+996 555 123 456')
  expect(phoneFromInput('+7 900 000 00 00')).toBe('+7 900 000 00 00')
  expect(phoneFromInput(' ')).toBe('')
  expect(phoneToInput('996555123456')).toBe('555 123 456')
})

test('админ: сохранить «О клинике» с днями и WhatsApp, предоплата, чистый лист', async () => {
  let saved: Schemas['ClinicControllerRequest'] | null = null
  let deposit: unknown = null
  let cleared: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.put('*/api/clinic', async ({ request }) => {
      saved = await request.json() as Schemas['ClinicControllerRequest']
      return HttpResponse.json({ ...clinic, ...saved })
    }),
    http.put('*/api/clinic/deposit', async ({ request }) => {
      deposit = await request.json()
      return HttpResponse.json({ mode: 'NEW', amountSom: 1000, hasQr: false } satisfies Schemas['DepositsSettings'])
    }),
    http.post('*/api/appointments/delete-all', async ({ request }) => {
      cleared = await request.json()
      return HttpResponse.json({ deleted: 3 } satisfies Schemas['AppointmentControllerDeleted'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'О клинике' }))
  const form = await screen.findByRole('form', { name: 'О клинике' })
  expect(within(form).getByRole('link', { name: `${window.location.origin}/c/test1` })).toBeInTheDocument()
  expect(within(form).getByRole('textbox', { name: 'WhatsApp клиники' })).toHaveValue('555 123 456')
  await user.click(within(form).getByRole('button', { name: 'Суббота' }))
  await user.click(within(form).getByRole('checkbox', { name: /независимо/ }))
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByText('Сохранено')).toBeInTheDocument()
  expect(saved).toMatchObject({
    whatsappPhone: '+996 555 123 456', independentDoctors: true, workStart: '09:00', workEnd: '18:00',
    workDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
  })

  await user.click(screen.getByRole('button', { name: 'Новых пациентов' }))
  await user.type(screen.getByRole('spinbutton', { name: 'Сколько, сом' }), '1000')
  await user.click(screen.getByRole('button', { name: 'Сохранить предоплату' }))
  expect(await screen.findByText('Предоплата сохранена')).toBeInTheDocument()
  expect(deposit).toEqual({ mode: 'NEW', amountSom: 1000, details: '' })

  await user.type(screen.getByRole('textbox', { name: 'Впишите УДАЛИТЬ' }), 'УДАЛИТЬ')
  await user.click(screen.getByRole('button', { name: 'Удалить все записи' }))
  expect(await screen.findByText('Удалено записей: 3')).toBeInTheDocument()
  expect(cleared).toEqual({ confirm: 'УДАЛИТЬ' })
})

test('регистратура: «О клинике» только просмотр, без предоплаты и удаления', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('tab', { name: 'О клинике' }))
  const form = await screen.findByRole('form', { name: 'О клинике' })
  expect(within(form).getByText(/Только просмотр/)).toBeInTheDocument()
  expect(within(form).getByRole('textbox', { name: 'Название для пациентов' })).toBeDisabled()
  expect(within(form).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  expect(screen.queryByText('Предоплата за запись')).not.toBeInTheDocument()
  expect(screen.queryByText('Начать с чистого листа')).not.toBeInTheDocument()
})
