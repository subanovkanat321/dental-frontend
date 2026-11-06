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

  const table = await screen.findByRole('table', { name: 'Персонал' })
  expect(within(table).getByText(/не привязан — пригласите в карточке/)).toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Дастан Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })

  const form = within(panel).getByRole('form', { name: 'Данные врача' })
  await user.type(within(form).getByRole('textbox', { name: /Кратко/ }), 'хирург')
  await user.type(within(form).getByRole('textbox', { name: 'Telegram id врача' }), '12ab')
  expect(within(form).getByText('Только цифры, как пишет @userinfobot')).toBeInTheDocument()
  await user.clear(within(form).getByRole('textbox', { name: 'Telegram id врача' }))
  await user.type(within(form).getByRole('textbox', { name: 'Telegram id врача' }), '222333')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Профиль врача сохранён')).toBeInTheDocument()
  expect(saved.doctor).toEqual({ fullName: 'Дастан Т.', about: 'хирург', telegramId: 222333, active: true })

  await user.click(await within(panel).findByRole('button', { name: 'Свои часы' }))
  await user.click(within(panel).getByRole('checkbox', { name: 'Понедельник' }))
  await user.click(within(panel).getByRole('button', { name: 'Сохранить часы' }))
  expect(await within(panel).findByText('Часы работы сохранены')).toBeInTheDocument()
  expect(saved.hours).toEqual({ days: [{ weekday: 'MONDAY', start: '09:00', end: '18:00' }] })

  // Врач ещё не вошёл — вместо «Сделать администратором» подсказка, как пригласить
  expect(within(panel).getByText(/Сделать врача администратором можно, когда он войдёт/)).toBeInTheDocument()
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
  // Админ, который и лечит, — строкой врача с двумя ролями рядом
  const staff = await screen.findByRole('table', { name: 'Персонал' })
  expect(staff).toHaveTextContent('ВрачАдминистратор')
  const form = screen.getByRole('form', { name: 'Пригласить сотрудника' })
  await user.type(within(form).getByRole('textbox', { name: /Имя/ }), 'Айпери')
  await user.click(within(form).getByRole('button', { name: 'Создать ссылку' }))
  expect(await screen.findByRole('link', { name: 'https://t.me/tish_test_bot?start=staff_xyz' })).toBeInTheDocument()
  expect(screen.getByText(/Отправьте её регистратору/)).toBeInTheDocument()
  expect(invited).toEqual({ role: 'RECEPTION', fullName: 'Айпери', alsoDoctor: false })
})

test('персонал: роли рядом, кто вошёл — «Telegram привязан», кто нет — «ждём входа» с отменой, фильтр по роли', async () => {
  let invites: Schemas['StaffMembersInviteView'][] = [
    { id: 'aa', fullName: 'Айпери', role: 'RECEPTION', expiresAt: '2099-01-01T06:00:00Z', expired: false },
    { id: 'bb', fullName: 'Опоздавшая', role: 'ADMIN', expiresAt: '2020-01-01T06:00:00Z', expired: true },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json([
      { telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true },
    ] satisfies Schemas['StaffMembersMemberView'][])),
    http.get('*/api/members/invites', () => HttpResponse.json(invites)),
    http.delete('*/api/members/invites/bb', () => {
      invites = invites.filter((i) => i.id !== 'bb')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  const pending = await screen.findByRole('table', { name: 'Персонал' })
  expect(pending).toHaveTextContent('✓ Telegram привязан')
  expect(pending).toHaveTextContent('Айпери')
  expect(pending).toHaveTextContent('ждём входа · ссылка до 1 янв, 12:00')
  expect(pending).toHaveTextContent('ссылка истекла — нужна новая')
  await user.click(within(pending).getAllByRole('button', { name: 'Отменить' })[1]!)
  await vi.waitFor(() => expect(pending).not.toHaveTextContent('Опоздавшая'))
  // Фильтр «Регистратура» — только Айпери (приглашена регистратором)
  await user.click(within(screen.getByRole('group', { name: 'Показать роль' })).getByRole('button', { name: /^Регистратура/ }))
  expect(pending).toHaveTextContent('Айпери')
  expect(pending).not.toHaveTextContent('Айгерим')
  vi.restoreAllMocks()
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
  // «Отмена» — несохранённые галочки не остаются до следующего «изменить»
  await user.click(within(edit).getByRole('checkbox', { name: 'Дастан Т.' }))
  await user.click(within(edit).getByRole('button', { name: 'Отмена' }))
  await user.click(screen.getByRole('button', { name: 'изменить' }))
  const again = screen.getByRole('form', { name: /Врачи ассистента Асель/ })
  expect(within(again).getByRole('checkbox', { name: 'Дастан Т.' })).toBeChecked()
  await user.click(within(again).getByRole('checkbox', { name: 'Айгерим Садыкова' }))
  await user.click(within(again).getByRole('button', { name: 'Сохранить' }))

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

test('врач (не админ): в «Персонале» только врачи, открывает только себя и правит профиль', async () => {
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
  const table = await screen.findByRole('table', { name: 'Персонал' })
  expect(within(table).queryByRole('button', { name: 'Дастан Т.' })).not.toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Айгерим Садыкова' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  expect(within(panel).queryByRole('textbox', { name: 'Telegram id врача' })).not.toBeInTheDocument()
  // Без правок «Сохранить» нет — нечего сохранять
  expect(within(panel).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  await user.type(within(panel).getByRole('textbox', { name: /Кратко/ }), 'терапевт')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Профиль врача сохранён')).toBeInTheDocument()
  expect(profile).toEqual({ fullName: 'Айгерим Садыкова', about: 'терапевт' })
})

test('ассистент: перерывы и выходные только смотрит — без формы и «Удалить»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, doctorId: undefined, assistantOf: [2] })),
    http.get('*/api/time-off', () => HttpResponse.json([
      { id: 1, doctorId: 2, weekday: 'FRIDAY', startTime: '12:00:00', endTime: '14:00:00', title: 'Джума-намаз', emoji: '🕌' },
    ] satisfies Schemas['TimeOffView'][])),
  )
  renderApp()
  openItem('timeoff')
  expect(await screen.findByText(/Джума-намаз/)).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Новый перерыв' })).not.toBeInTheDocument()
  expect(screen.getByText(/ставят врач, регистратура или администратор/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument()
})

test('карточка врача: «Услуги врача» — все или только отмеченные', async () => {
  const sent: Schemas['DoctorServicesControllerRequest'][] = []
  let who: Schemas['BookingViewsMe'] = me
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(who)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.get('*/api/service-types', () => HttpResponse.json([
      { id: 5, name: 'Лечение кариеса', durationMinutes: 60, category: 'Терапия', active: true },
      { id: 6, name: 'Удаление зуба', durationMinutes: 45, category: 'Хирургия', active: true },
      { id: 7, name: 'Старая услуга', durationMinutes: 30, active: false },
    ] satisfies Schemas['ServiceTypeView'][])),
    http.put('*/api/doctors/:id/service-types', async ({ request, params }) => {
      const body = await request.json() as Schemas['DoctorServicesControllerRequest']
      sent.push(body)
      const ids = body.serviceTypeIds ?? []
      who = { ...me, doctorServices: ids.length ? [{ doctorId: Number(params.id), serviceTypeIds: ids }] : [] }
      return HttpResponse.json({ doctorId: Number(params.id), serviceTypeIds: ids } satisfies Schemas['DoctorServicesView'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Персонал' })).getByRole('button', { name: 'Дастан Т.' }))
  const box = within(await screen.findByRole('complementary', { name: 'Врач' })).getByRole('region', { name: 'Услуги врача' })
  expect(within(box).getByRole('button', { name: 'Все услуги клиники' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(within(box).getByRole('button', { name: 'Только выбранные' }))
  // Скрытые услуги не предлагаем
  expect(await within(box).findByRole('checkbox', { name: 'Лечение кариеса' })).toBeInTheDocument()
  expect(within(box).queryByRole('checkbox', { name: 'Старая услуга' })).not.toBeInTheDocument()
  await user.click(within(box).getByRole('button', { name: 'Сохранить услуги' }))
  expect(within(box).getByRole('alert')).toHaveTextContent('Отметьте хотя бы одну услугу')
  await user.click(within(box).getByRole('checkbox', { name: 'Удаление зуба' }))
  await user.click(within(box).getByRole('button', { name: 'Сохранить услуги' }))
  expect(await within(box).findByText('Услуги врача сохранены')).toBeInTheDocument()

  await user.click(within(box).getByRole('button', { name: 'Все услуги клиники' }))
  await user.click(within(box).getByRole('button', { name: 'Сохранить услуги' }))
  await vi.waitFor(() => expect(sent).toEqual([{ serviceTypeIds: [6] }, { serviceTypeIds: [] }]))
})

test('регистратура открывает врача ради часов — «Услуги врача» не видит', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: false, reception: true, doctorId: undefined })),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
  )
  const user = userEvent.setup()
  renderApp()
  await user.click(within(await screen.findByRole('table', { name: 'Персонал' })).getByRole('button', { name: 'Дастан Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  expect(within(panel).getByText('Часы работы')).toBeInTheDocument()
  expect(within(panel).queryByRole('region', { name: 'Услуги врача' })).not.toBeInTheDocument()
})

test('«Сменить роль»: регистратор → ассистент (с врачами), без новой ссылки', async () => {
  // Сотрудники вымышленные
  let members: Schemas['StaffMembersMemberView'][] = [
    { telegramId: 501, fullName: 'Айпери', role: 'RECEPTION', me: false, doctor: false, doctorIds: [] },
  ]
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.get('*/api/members/invites', () => HttpResponse.json([])),
    http.put('*/api/members/:id/role', async ({ request }) => {
      const body = await request.json() as Schemas['StaffMembersControllerRoleChange']
      sent.push(body)
      members = [{ ...members[0]!, role: body.role, doctorIds: body.doctorIds ?? [] }]
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await user.click(await within(table).findByRole('button', { name: 'Сменить роль' }))
  const form = within(table).getByRole('form', { name: 'Роль: Айпери' })
  await user.click(within(form).getByRole('button', { name: 'Ассистент' }))
  // Ассистенту — хотя бы один врач
  expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  await user.click(within(form).getByRole('checkbox', { name: /Дастан Т\./ }))
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(sent).toEqual([{ role: 'ASSISTANT', doctorIds: [2] }])
  expect(await within(table).findByText('Ассистент')).toBeInTheDocument()
  expect(within(table).getByText(/Помогает: Дастан Т\./)).toBeInTheDocument()
})

test('«Пригласить по номеру»: без Telegram — сотрудник сразу в персонале, вход «по SMS» с номером', async () => {
  let invited: unknown = null
  let members: Schemas['StaffMembersMemberView'][] = [{ telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true }]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.post('*/api/members/invite-phone', async ({ request }) => {
      invited = await request.json()
      members = [...members, { telegramId: -1000000000000001, fullName: 'Нурия', role: 'RECEPTION', phone: '+996700000011', phoneOnly: true, doctor: false }]
      return HttpResponse.json({ telegramId: -1000000000000001 } satisfies Schemas['StaffMembersControllerPhoneInvited'], { status: 201 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await user.click(screen.getByRole('button', { name: 'Пригласить по номеру' }))
  const form = screen.getByRole('form', { name: 'Пригласить по номеру' })
  await user.type(within(form).getByRole('textbox', { name: 'Номер телефона сотрудника' }), '700000011')
  await user.type(within(form).getByRole('textbox', { name: /Имя/ }), 'Нурия')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByText(/Нурия — в персонале/)).toBeInTheDocument()
  expect(invited).toEqual({ phone: '+996 700000011', role: 'RECEPTION', fullName: 'Нурия', alsoDoctor: false })
  await vi.waitFor(() => expect(table).toHaveTextContent('✓ по номеру'))
  expect(table).toHaveTextContent('+996 700 000 011')

  // SMS не доходят — админ задаёт временный пароль (себе — нет: у своей строки кнопки нет)
  expect(within(table).getAllByRole('button', { name: 'Временный пароль' })).toHaveLength(1)
  let temporary: { id: string; body: unknown } | null = null
  server.use(http.put('*/api/members/:id/temporary-password', async ({ request, params }) => {
    const body = await request.json() as Schemas['PasswordControllerTemporaryPassword']
    if ((body.password ?? '').length < 8) {
      return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'password', message: 'Пароль — не короче 8 символов' }] }, { status: 422 })
    }
    temporary = { id: String(params.id), body }
    return new HttpResponse(null, { status: 204 })
  }))
  // Окно notify — через подмену window.confirm (test/setup.ts): проверяем текст сообщения
  const shown = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(within(table).getByRole('button', { name: 'Временный пароль' }))
  const tempForm = within(table).getByRole('form', { name: 'Временный пароль: Нурия' })
  await user.type(within(tempForm).getByLabelText('Временный пароль'), 'коротк')
  await user.click(within(tempForm).getByRole('button', { name: 'Задать' }))
  expect(await within(tempForm).findByRole('alert')).toHaveTextContent('не короче 8 символов')
  await user.type(within(tempForm).getByLabelText('Временный пароль'), 'ий-1')
  await user.click(within(tempForm).getByRole('button', { name: 'Задать' }))
  await vi.waitFor(() => expect(shown).toHaveBeenCalledWith(expect.stringContaining('Временный пароль для «Нурия» задан')))
  expect(temporary).toEqual({ id: '-1000000000000001', body: { password: 'короткий-1' } })
})

test('карточка врача без Telegram: привязать номер для входа по SMS; уже по SMS — поле Telegram id скрыто', async () => {
  let bound: unknown = null
  let list: Schemas['DoctorAdminView'][] = doctors
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(list)),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.post('*/api/doctors/:id/phone', async ({ request }) => {
      bound = await request.json()
      list = [doctors[0]!, { ...doctors[1]!, telegramId: -1000000000000002, phone: '+996700000022', phoneOnly: true }]
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await user.click(within(table).getByRole('button', { name: 'Дастан Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  await user.click(within(panel).getByRole('button', { name: 'Нет Telegram? Вход по номеру телефона' }))
  await user.type(within(panel).getByRole('textbox', { name: 'Номер телефона врача' }), '0700000022')
  await user.click(within(panel).getByRole('button', { name: 'Привязать номер' }))
  expect(await within(panel).findByText('+996 700 000 022')).toBeInTheDocument()
  expect(panel).toHaveTextContent('Без Telegram это его единственный вход')
  // Номер без Telegram — только сменить, «Убрать» нет
  expect(within(panel).getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Убрать номер' })).not.toBeInTheDocument()
  expect(bound).toEqual({ phone: '0700000022' })
  expect(within(panel).queryByRole('textbox', { name: 'Telegram id врача' })).not.toBeInTheDocument()
  expect(table).toHaveTextContent('✓ по номеру')
  expect(table).toHaveTextContent('+996 700 000 022')
})

test('«Телефон» в «Персонале»: сотруднику с Telegram — только показать (номер он задаёт сам); без Telegram — админ меняет, чужой номер — 409', async () => {
  const puts: unknown[] = []
  let members: Schemas['StaffMembersMemberView'][] = [
    { telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true },
    { telegramId: 5001, fullName: 'Бермет', role: 'RECEPTION', doctor: false, phoneOnly: false, phone: '+996700000041' },
    { telegramId: -1000000000000001, fullName: 'Нурия', role: 'RECEPTION', doctor: false, phoneOnly: true, phone: '+996700000011' },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.get('*/api/members/invites', () => HttpResponse.json([])),
    http.put('*/api/members/:id/phone', async ({ request, params }) => {
      const body = await request.json() as Schemas['StaffMembersControllerPhoneChange']
      puts.push({ id: String(params.id), ...body })
      if (body.phone === '+996 700000041') {
        return HttpResponse.json({ status: 409, code: 'phone-taken', detail: 'Этот номер уже у другого сотрудника' }, { status: 409 })
      }
      members = members.map((m) => (m.telegramId === -1000000000000001 ? { ...m, phone: '+996700000012' } : m))
      return HttpResponse.json({ phone: '+996700000012', phoneOnly: true } satisfies Schemas['StaffPhonesPhoneView'])
    }),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  const table = await screen.findByRole('table', { name: 'Персонал' })
  expect(screen.getByText(/По этому номеру можно войти на сайте без Telegram: код из SMS, потом свой пароль/)).toBeInTheDocument()
  expect(screen.getByText(/сотрудник с Telegram указывает номер для входа сам: Настройки → Мой профиль/)).toBeInTheDocument()

  // Бермет (Telegram): номер виден, но кнопок нет — только подсказка
  const bermet = (await within(table).findByText('Бермет')).closest('tr')!
  expect(bermet).toHaveTextContent('+996 700 000 041')
  expect(within(bermet).getByTitle('Номер для входа сотрудник указывает сам: Настройки → Мой профиль.')).toBeInTheDocument()
  expect(within(bermet).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  expect(within(bermet).queryByRole('button', { name: 'Убрать номер' })).not.toBeInTheDocument()

  // Нурия (без Telegram): админ меняет номер, убрать нельзя
  const nuria = within(table).getByText('Нурия').closest('tr')!
  expect(within(nuria).queryByRole('button', { name: 'Убрать номер' })).not.toBeInTheDocument()
  await user.click(within(nuria).getByRole('button', { name: 'Изменить' }))
  const form = within(table).getByRole('form', { name: 'Телефон: Нурия' })
  await user.clear(within(form).getByRole('textbox', { name: 'Телефон' }))
  await user.type(within(form).getByRole('textbox', { name: 'Телефон' }), '700000041')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('Этот номер уже у другого сотрудника')
  await user.clear(within(form).getByRole('textbox', { name: 'Телефон' }))
  await user.type(within(form).getByRole('textbox', { name: 'Телефон' }), '700000012')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(table).findByText('+996 700 000 012')).toBeInTheDocument()
  expect(puts).toEqual([{ id: '-1000000000000001', phone: '+996 700000041' }, { id: '-1000000000000001', phone: '+996 700000012' }])
})
