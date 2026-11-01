import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, openItem } from '../test/fixtures'
import { server } from '../test/server'
import { timeOffWhen } from './texts'

beforeEach(() => {
  window.location.hash = '/settings/doctors'
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })))
})
afterEach(() => {
  window.location.hash = ''
})

const doctors: Schemas['DoctorAdminView'][] = [
  { id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт', active: true, telegramId: 111, role: 'ADMIN' },
  { id: 2, fullName: 'Дастан Т.', about: '', active: true },
]

test('перерыв: подпись «когда»', () => {
  expect(timeOffWhen({ weekday: 'FRIDAY', startTime: '12:00:00', endTime: '14:00:00', title: 'Намаз' })).toBe('Каждую пятницу · 12:00–14:00')
  expect(timeOffWhen({ firstDay: '2026-11-03', lastDay: '2026-11-10', title: 'Отпуск' })).toBe('3 нояб – 10 нояб · весь день')
})

test('админ: врачи таблицей; карточка — сохранить данные, свои часы, ссылка-приглашение', async () => {
  const saved: Record<string, unknown> = {}
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.put('*/api/doctors/:id', async ({ request }) => {
      saved.doctor = await request.json()
      return HttpResponse.json(doctors[1])
    }),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/doctors/:id/hours', async ({ request }) => {
      saved.hours = await request.json()
      return HttpResponse.json({ custom: true, days: (saved.hours as Schemas['DoctorHoursControllerRequest']).days } satisfies Schemas['DoctorHoursView'])
    }),
    http.post('*/api/doctors/:id/invite', () => HttpResponse.json({ token: 'abc123' } satisfies Schemas['DoctorInvitesInvite'])),
  )
  const user = userEvent.setup()
  renderApp()

  const table = await screen.findByRole('table', { name: 'Врачи' })
  expect(within(table).getByText('не привязан')).toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Дастан Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })

  const form = within(panel).getByRole('form', { name: 'Данные врача' })
  await user.type(within(form).getByRole('textbox', { name: /Кратко/ }), 'хирург')
  await user.type(within(form).getByRole('textbox', { name: 'Telegram id врача' }), '12ab')
  expect(within(form).getByText('Только цифры, как пишет @userinfobot')).toBeInTheDocument()
  await user.clear(within(form).getByRole('textbox', { name: 'Telegram id врача' }))
  await user.type(within(form).getByRole('textbox', { name: 'Telegram id врача' }), '222333')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Сохранено')).toBeInTheDocument()
  expect(saved.doctor).toEqual({ fullName: 'Дастан Т.', about: 'хирург', telegramId: 222333, active: true })

  await user.click(await within(panel).findByRole('button', { name: 'Свои часы' }))
  await user.click(within(panel).getByRole('checkbox', { name: 'Понедельник' }))
  await user.click(within(panel).getByRole('button', { name: 'Сохранить часы' }))
  expect(await within(panel).findByText('Часы работы сохранены')).toBeInTheDocument()
  expect(saved.hours).toEqual({ days: [{ weekday: 'MONDAY', start: '09:00', end: '18:00' }] })

  await user.click(within(panel).getByRole('button', { name: 'Пригласить по ссылке' }))
  expect(await within(panel).findByRole('link', { name: 'https://t.me/tish_test_bot?start=join_abc123' })).toBeInTheDocument()
})

test('сотрудники: пригласить регистратора ссылкой', async () => {
  let invited: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json([
      { telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true },
    ] satisfies Schemas['StaffMembersMemberView'][])),
    http.post('*/api/members/invite', async ({ request }) => {
      invited = await request.json()
      return HttpResponse.json({ token: 'xyz' } satisfies Schemas['DoctorInvitesInvite'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  expect(await screen.findByText('Администратор · врач · это вы')).toBeInTheDocument()
  const form = screen.getByRole('form', { name: 'Пригласить сотрудника' })
  await user.type(within(form).getByRole('textbox', { name: /Имя/ }), 'Айпери')
  await user.click(within(form).getByRole('button', { name: 'Создать ссылку' }))
  expect(await screen.findByRole('link', { name: 'https://t.me/tish_test_bot?start=staff_xyz' })).toBeInTheDocument()
  expect(screen.getByText(/Отправьте её регистратору/)).toBeInTheDocument()
  expect(invited).toEqual({ role: 'RECEPTION', fullName: 'Айпери', alsoDoctor: false })
})

test('сотрудники: ассистент — выбрать врача, потом поменять врачей', async () => {
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json([
      { telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true },
      { telegramId: 7201, fullName: 'Асель', role: 'ASSISTANT', doctorIds: [2] },
    ] satisfies Schemas['StaffMembersMemberView'][])),
    http.post('*/api/members/invite', async ({ request }) => {
      sent.push(await request.json())
      return HttpResponse.json({ token: 'asst' } satisfies Schemas['DoctorInvitesInvite'])
    }),
    http.put('*/api/members/7201/doctors', async ({ request }) => {
      sent.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  expect(await screen.findByText(/Помогает: Дастан Т\./)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'изменить' }))
  const edit = screen.getByRole('form', { name: /Врачи ассистента Асель/ })
  await user.click(within(edit).getByRole('checkbox', { name: 'Айгерим Садыкова' }))
  await user.click(within(edit).getByRole('button', { name: 'Сохранить' }))

  const form = screen.getByRole('form', { name: 'Пригласить сотрудника' })
  await user.type(within(form).getByRole('textbox', { name: /Имя/ }), 'Жылдыз')
  await user.click(within(form).getByRole('button', { name: 'Ассистент' }))
  await user.click(within(form).getByRole('checkbox', { name: 'Дастан Т.' }))
  await user.click(within(form).getByRole('button', { name: 'Создать ссылку' }))
  expect(await screen.findByText(/Отправьте её ассистенту/)).toBeInTheDocument()
  expect(sent).toEqual([{ doctorIds: [2, 1] }, { role: 'ASSISTANT', fullName: 'Жылдыз', doctorIds: [2] }])
})

test('перерывы: список, добавить еженедельный, удалить', async () => {
  let list: Schemas['TimeOffView'][] = [{ id: 1, doctorId: undefined, weekday: 'FRIDAY', startTime: '12:00:00', endTime: '14:00:00', title: 'Джума-намаз', emoji: '🕌' }]
  let posted: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/time-off', () => HttpResponse.json(list)),
    http.post('*/api/time-off', async ({ request }) => {
      posted = await request.json()
      const t = { id: 2, ...(posted as Schemas['TimeOffControllerRequest']) }
      list = [...list, t]
      return HttpResponse.json(t)
    }),
    http.delete('*/api/time-off/:id', ({ params }) => {
      list = list.filter((t) => String(t.id) !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  openItem('timeoff')
  const table = await screen.findByRole('table', { name: 'Перерывы' })
  expect(within(table).getByText('Все врачи')).toBeInTheDocument()

  const form = screen.getByRole('form', { name: 'Новый перерыв' })
  await user.click(within(form).getByRole('button', { name: 'Вторник' }))
  await user.type(within(form).getByRole('textbox', { name: 'Название' }), 'Обед')
  await user.click(within(form).getByRole('button', { name: 'Добавить перерыв' }))
  expect(await screen.findByText('Обед')).toBeInTheDocument()
  expect(posted).toEqual({ doctorId: 1, weekday: 'TUESDAY', startTime: '13:00', endTime: '14:00', title: 'Обед', emoji: '🕌' })

  await user.click(screen.getByRole('button', { name: 'Удалить: Джума-намаз' }))
  expect(await screen.findByText('Перерыв добавлен')).toBeInTheDocument()
  await vi.waitFor(() => expect(screen.queryByText('Джума-намаз')).not.toBeInTheDocument())
})

test('врач (не админ): без «Сотрудников», открывает только себя и правит профиль', async () => {
  let profile: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false })),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/doctors/:id/profile', async ({ request }) => {
      profile = await request.json()
      return HttpResponse.json(doctors[0])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Врачи' })
  expect(within(table).queryByRole('button', { name: 'Дастан Т.' })).not.toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Айгерим Садыкова' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  expect(within(panel).queryByRole('textbox', { name: 'Telegram id врача' })).not.toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Сохранено')).toBeInTheDocument()
  expect(profile).toEqual({ fullName: 'Айгерим Садыкова', about: '' })
})
