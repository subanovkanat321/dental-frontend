import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

// «Сменить Telegram» в карточке сотрудника: руководитель делает ссылку за сотрудника. Вымышленные люди и id.

const doctors: Schemas['DoctorAdminView'][] = [
  { id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false },
  { id: 2, fullName: 'Нурболот А.', about: 'хирург', active: true, telegramId: 222, phoneOnly: false },
]
const members: Schemas['StaffMembersMemberView'][] = [
  { telegramId: 111, fullName: 'Айгерим Садыкова', role: 'ADMIN', me: true, doctor: true, phoneOnly: false, doctorIds: [] },
  { telegramId: 503, fullName: 'Асель', role: 'ASSISTANT', me: false, doctor: false, phoneOnly: false, doctorIds: [] },
  { telegramId: -1000000000000007, fullName: 'Бермет', role: 'RECEPTION', me: false, doctor: false, phoneOnly: true, phone: '+996700000071', doctorIds: [] },
]
const admin: Schemas['BookingViewsMe'] = {
  ...me, doctors: doctors.map((d) => ({ id: d.id, fullName: d.fullName, active: true, telegramLinked: true })),
}

function backend() {
  const started: string[] = []
  server.use(
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })),
    http.get('*/api/patient/me', () => HttpResponse.json(admin)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.get('*/api/shifts/weekly/:id', () => HttpResponse.json({ telegramId: 503, custom: false, days: [] } satisfies Schemas['ShiftServiceWeekly'])),
    http.post('*/api/members/:id/telegram-change', ({ params }) => {
      started.push(String(params.id))
      return HttpResponse.json({ link: `https://t.me/tish_test_bot?start=tgmove_${params.id}x`, secondsLeft: 900 } satisfies Schemas['TelegramChangeControllerChangeStarted'])
    }),
  )
  return started
}

beforeEach(() => {
  window.location.hash = '/clinic/staff'
})
afterEach(() => {
  window.location.hash = ''
})

test('карточка сотрудника: «Сменить Telegram» → ссылка, которую отправить ему (WhatsApp, скопировать)', async () => {
  const started = backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Персонал' })).getByRole('button', { name: 'Асель' }))
  const panel = await screen.findByRole('complementary', { name: 'Сотрудник' })
  const access = within(panel).getByRole('region', { name: 'Вход' })
  await user.click(within(access).getByRole('button', { name: 'Сменить Telegram' }))
  const link = await within(access).findByRole('link', { name: 'https://t.me/tish_test_bot?start=tgmove_503x' })
  expect(link).toBeInTheDocument()
  expect(started).toEqual(['503'])
  expect(access).toHaveTextContent('Ссылка работает один раз и 15 минут')
  expect(access).toHaveTextContent('«✅ Да, перенести»')
  expect(within(access).getByRole('button', { name: 'Отправить в WhatsApp' })).toBeInTheDocument()
  expect(within(access).getByRole('button', { name: 'Скопировать' })).toBeInTheDocument()
})

test('сотрудник по номеру — «Сменить Telegram» нет; в карточке врача — есть', async () => {
  const started = backend()
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await user.click(within(table).getByRole('button', { name: 'Бермет' }))
  const member = await screen.findByRole('complementary', { name: 'Сотрудник' })
  expect(within(member).queryByRole('button', { name: 'Сменить Telegram' })).not.toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: 'Нурболот А.' }))
  const doctor = await screen.findByRole('complementary', { name: 'Врач' })
  await user.click(await within(doctor).findByRole('button', { name: 'Сменить Telegram' }))
  expect(await within(doctor).findByRole('link', { name: 'https://t.me/tish_test_bot?start=tgmove_222x' })).toBeInTheDocument()
  expect(started).toEqual(['222'])
})
