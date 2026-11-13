import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp, openItem } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

beforeEach(() => {
  window.location.hash = '/settings/doctors'
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot' })))
})
afterEach(() => {
  window.location.hash = ''
})

const doctors: Schemas['DoctorAdminView'][] = [
  { id: 1, fullName: 'Айгерим Садыкова', about: 'терапевт', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false },
  { id: 2, fullName: 'Дастан Т.', about: '', active: true, phoneOnly: false },
]

test('админ: карточка врача, который ещё не вошёл, — «Роли», черновик профиля, свои часы, ссылка-приглашение; снять «Врач» — с подтверждением', async () => {
  const saved: Record<string, unknown> = {}
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.put('*/api/doctors/:id/profile', async ({ request }) => {
      saved.profile = await request.json()
      return HttpResponse.json(doctors[1])
    }),
    http.put('*/api/staff/roles', async ({ request }) => {
      saved.roles = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/doctors/:id/hours', async ({ request }) => {
      saved.hours = await request.json()
      return HttpResponse.json({ custom: true, days: (saved.hours as Schemas['DoctorHoursControllerRequest']).days } satisfies Schemas['DoctorHoursView'])
    }),
    http.post('*/api/doctors/:id/invite', () => HttpResponse.json({ token: 'abc123' } satisfies Schemas['DoctorInvitesInvite'])),
  )
  const asked = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()

  const table = await screen.findByRole('table', { name: 'Персонал' })
  expect(within(table).getByText(/ждём входа — пригласите в карточке/)).toBeInTheDocument()
  // Одна кнопка добавления — прежних «+ Добавить врача» и форм внизу нет
  expect(screen.getByRole('button', { name: '+ Добавить сотрудника' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '+ Добавить врача' })).not.toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Пригласить сотрудника' })).not.toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Дастан Т.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  for (const name of ['Роли', 'Для пациентов', 'Работа', 'Вход']) {
    expect(within(panel).getByRole('region', { name })).toBeInTheDocument()
  }
  expect(within(panel).queryByRole('textbox', { name: /Telegram id/ })).not.toBeInTheDocument()

  const patients = within(panel).getByRole('region', { name: 'Для пациентов' })
  expect(patients).toHaveTextContent('Врач ещё не вошёл — можно заполнить черновик')
  const form = within(patients).getByRole('form', { name: 'Данные врача' })
  await user.type(within(form).getByRole('textbox', { name: /Кратко/ }), 'хирург')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Профиль врача сохранён')).toBeInTheDocument()
  expect(saved.profile).toEqual({ fullName: 'Дастан Т.', about: 'хирург' })

  await user.click(await within(panel).findByRole('button', { name: 'Свои часы' }))
  await user.click(within(panel).getByRole('checkbox', { name: 'Понедельник' }))
  await user.click(within(panel).getByRole('button', { name: 'Сохранить часы' }))
  expect(await within(panel).findByText('Часы работы сохранены')).toBeInTheDocument()
  expect(saved.hours).toEqual({ days: [{ weekday: 'MONDAY', start: '09:00', end: '18:00' }] })

  const access = within(panel).getByRole('region', { name: 'Вход' })
  expect(access).toHaveTextContent('Ждём входа')
  await user.click(within(access).getByRole('button', { name: 'Пригласить по ссылке' }))
  expect(await within(access).findByRole('link', { name: `${window.location.origin}/invite#join_abc123` })).toBeInTheDocument()

  // Роли: врач без входа — роль в клинике не дать; снять «Врач» = скрыть, с подтверждением
  const roles = within(panel).getByRole('region', { name: 'Роли' })
  expect(within(roles).getByRole('button', { name: 'Руководитель' })).toBeDisabled()
  expect(roles).toHaveTextContent('Роль в клинике дают тому, кто вошёл')
  await user.click(within(roles).getByRole('checkbox', { name: /^Врач/ }))
  await user.click(within(roles).getByRole('button', { name: 'Сохранить роли' }))
  await waitForSlow(() => expect(saved.roles).toEqual({ doctorId: 2, doctor: false }))
  expect(asked).toHaveBeenCalledWith(expect.stringContaining('Врач скроется: пациенты его не увидят'))
  vi.restoreAllMocks()
})

test('админ: у вошедшего врача фото, имя и «о себе» — только посмотреть; роль руководителя — флажками в «Ролях»', async () => {
  const linked: Schemas['DoctorAdminView'] = { id: 3, fullName: 'Бермет К.', about: 'ортодонт, брекеты', active: true, telegramId: 333, photoUrl: '/doctors/3/photo?v=1', phoneOnly: false }
  let roles: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json([...doctors, linked])),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.put('*/api/staff/roles', async ({ request }) => {
      roles = await request.json()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await user.click(within(table).getByRole('button', { name: 'Бермет К.' }))
  const panel = await screen.findByRole('complementary', { name: 'Врач' })

  const patients = within(panel).getByRole('region', { name: 'Для пациентов' })
  expect(within(patients).queryByRole('textbox')).not.toBeInTheDocument()
  expect(within(patients).getByRole('img', { name: 'Фото врача' })).toBeInTheDocument()
  expect(patients).toHaveTextContent('Фото, имя и «о себе» врач заполняет сам — в «Моём профиле» (нажать на себя внизу меню).')

  const work = within(panel).getByRole('region', { name: 'Работа' })
  // «Работает» — теперь флажок «Врач» в «Ролях»
  expect(within(work).queryByRole('checkbox', { name: 'Работает (показывать пациентам)' })).not.toBeInTheDocument()
  expect(within(work).getByRole('region', { name: 'Услуги врача' })).toBeInTheDocument()
  const access = within(panel).getByRole('region', { name: 'Вход' })
  expect(access).toHaveTextContent('✓ Telegram подключён')
  expect(access).not.toHaveTextContent('333')

  const box = within(panel).getByRole('region', { name: 'Роли' })
  expect(within(box).getByRole('checkbox', { name: /^Врач/ })).toBeChecked()
  // Врач + Ассистент нельзя — кнопка ассистента недоступна, правило написано
  expect(within(box).getByRole('button', { name: 'Ассистент' })).toBeDisabled()
  expect(box).toHaveTextContent('Ассистент врачом быть не может')
  await user.click(within(box).getByRole('button', { name: 'Руководитель' }))
  await user.click(within(box).getByRole('button', { name: 'Сохранить роли' }))
  await waitForSlow(() => expect(roles).toEqual({ doctorId: 3, telegramId: 333, doctor: true, role: 'ADMIN' }))
})

test('«+ Добавить сотрудника»: врач по ссылке — ссылка и карточка; регистратура «тоже ведёт приём» по номеру; ассистенту — врачи', async () => {
  const sent: Schemas['StaffControllerAddRequest'][] = []
  let list: Schemas['DoctorAdminView'][] = doctors
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(list)),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
    http.post('*/api/staff', async ({ request }) => {
      const body = await request.json() as Schemas['StaffControllerAddRequest']
      sent.push(body)
      if (body.role === 'DOCTOR') {
        list = [...doctors, { id: 9, fullName: 'Бакыт', active: true, phoneOnly: false }]
        return HttpResponse.json({ doctorId: 9, start: 'join_new9', summary: 'врача, вход по ссылке' } satisfies Schemas['StaffRolesAdded'], { status: 201 })
      }
      if (body.login === 'PHONE') {
        return HttpResponse.json({ status: 409, code: 'phone-taken', detail: 'Этот номер уже работает в другой клинике' }, { status: 409 })
      }
      return HttpResponse.json({ inviteId: 'cc', start: 'staff_x', summary: 'ассистента' } satisfies Schemas['StaffRolesAdded'], { status: 201 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  await screen.findByRole('table', { name: 'Персонал' })
  await user.click(screen.getByRole('button', { name: '+ Добавить сотрудника' }))
  let form = await screen.findByRole('form', { name: 'Добавить сотрудника' })
  await user.type(within(form).getByRole('textbox', { name: /Имя/ }), 'Бакыт')
  expect(within(within(form).getByRole('group', { name: 'Роль' })).getByRole('button', { name: 'Врач' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await screen.findByRole('link', { name: `${window.location.origin}/invite#join_new9` })).toBeInTheDocument()
  expect(screen.getByText(/Отправьте её врачу/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Открыть карточку' }))
  expect(await screen.findByRole('complementary', { name: 'Врач' })).toHaveTextContent('Бакыт')

  // Регистратура, тоже ведёт приём, по номеру — номер занят: ошибка сервера в форме
  await user.click(screen.getByRole('button', { name: '+ Добавить сотрудника' }))
  form = await screen.findByRole('form', { name: 'Добавить сотрудника' })
  await user.type(within(form).getByRole('textbox', { name: /Имя/ }), 'Айпери')
  await user.click(within(form).getByRole('button', { name: 'Регистратура' }))
  await user.click(within(form).getByRole('checkbox', { name: /Тоже ведёт приём/ }))
  await user.click(within(form).getByRole('button', { name: 'Номер телефона' }))
  expect(within(form).getByRole('button', { name: 'Добавить' })).toBeDisabled()
  await user.type(within(form).getByRole('textbox', { name: 'Номер телефона сотрудника' }), '700000011')
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('Этот номер уже работает в другой клинике')

  // Ассистент — без врача «Добавить» недоступно; «позже» — сразу карточка приглашения
  await user.click(within(form).getByRole('button', { name: 'Ассистент' }))
  expect(within(form).queryByRole('checkbox', { name: /Тоже ведёт приём/ })).not.toBeInTheDocument()
  await user.click(within(form).getByRole('button', { name: 'Позже' }))
  expect(within(form).getByRole('button', { name: 'Добавить' })).toBeDisabled()
  await user.click(within(form).getByRole('checkbox', { name: 'Дастан Т.' }))
  await user.click(within(form).getByRole('button', { name: 'Добавить' }))
  await waitForSlow(() => expect(sent).toHaveLength(3))
  expect(sent).toEqual([
    { fullName: 'Бакыт', role: 'DOCTOR', login: 'LINK' },
    { fullName: 'Айпери', role: 'RECEPTION', login: 'PHONE', alsoDoctor: true, phone: '+996 700000011' },
    { fullName: 'Айпери', role: 'ASSISTANT', login: 'LATER', doctorIds: [2] },
  ])
})

test('персонал: роли рядом, «Telegram привязан» и «ждём входа»; карточка приглашения — новая ссылка и отмена; фильтр по роли', async () => {
  let invites: Schemas['StaffMembersInviteView'][] = [
    { id: 'aa', fullName: 'Айпери', role: 'RECEPTION', expiresAt: '2099-01-01T06:00:00Z', expired: false },
    { id: 'bb', fullName: 'Опоздавшая', role: 'ADMIN', expiresAt: '2020-01-01T06:00:00Z', expired: true },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json([
      { telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true, phoneOnly: false },
    ] satisfies Schemas['StaffMembersMemberView'][])),
    http.get('*/api/members/invites', () => HttpResponse.json(invites)),
    http.post('*/api/members/invites/bb/renew', () => HttpResponse.json({ token: 'fresh' } satisfies Schemas['DoctorInvitesInvite'])),
    http.delete('*/api/members/invites/bb', () => {
      invites = invites.filter((i) => i.id !== 'bb')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  const table = await screen.findByRole('table', { name: 'Персонал' })
  // Админ, который и лечит, — одной строкой врача с двумя ролями
  expect(table).toHaveTextContent('ВрачРуководитель')
  expect(table).toHaveTextContent('✓ Telegram привязан')
  expect(table).toHaveTextContent('ждём входа · ссылка до 1 янв, 12:00')
  expect(table).toHaveTextContent('ссылка истекла — нужна новая')
  await user.click(within(table).getByRole('button', { name: 'Опоздавшая' }))
  const card = await screen.findByRole('complementary', { name: 'Приглашение' })
  expect(card).toHaveTextContent('Ссылка истекла — нужна новая')
  await user.click(within(card).getByRole('button', { name: 'Новая ссылка' }))
  expect(await within(card).findByRole('link', { name: `${window.location.origin}/invite#staff_fresh` })).toBeInTheDocument()
  expect(card).toHaveTextContent('Отправьте её руководителю')
  await user.click(within(card).getByRole('button', { name: 'Отменить приглашение' }))
  await waitForSlow(() => expect(table).not.toHaveTextContent('Опоздавшая'))
  await user.click(within(screen.getByRole('group', { name: 'Показать роль' })).getByRole('button', { name: /^Регистратура/ }))
  expect(table).toHaveTextContent('Айпери')
  expect(table).not.toHaveTextContent('Айгерим')
  vi.restoreAllMocks()
})

test('карточка сотрудника: регистратор → ассистент с врачами; ассистент + врач — нельзя; недельный график «как у клиники»', async () => {
  let members: Schemas['StaffMembersMemberView'][] = [
    { telegramId: 501, fullName: 'Айпери', role: 'RECEPTION', me: false, doctor: false, doctorIds: [], phoneOnly: false },
  ]
  const sent: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.get('*/api/shifts/weekly/:id', () => HttpResponse.json({ telegramId: 501, custom: false, days: [
      { weekday: 'MONDAY', start: '09:00:00', end: '18:00:00' }, { weekday: 'TUESDAY', start: '09:00:00', end: '18:00:00' },
    ] } satisfies Schemas['ShiftServiceWeekly'])),
    http.put('*/api/staff/roles', async ({ request }) => {
      const body = await request.json() as Schemas['StaffControllerRolesRequest']
      sent.push(body)
      members = [{ ...members[0]!, role: body.role, doctorIds: body.doctorIds ?? [] }]
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  renderApp()
  const table = await screen.findByRole('table', { name: 'Персонал' })
  await user.click(await within(table).findByRole('button', { name: 'Айпери' }))
  const card = await screen.findByRole('complementary', { name: 'Сотрудник' })
  expect(await within(card).findByRole('button', { name: 'Как у клиники' })).toHaveAttribute('aria-pressed', 'true')
  const roles = within(card).getByRole('form', { name: 'Роли' })
  await user.click(within(roles).getByRole('button', { name: 'Ассистент' }))
  // Ассистенту — хотя бы один врач; «Врач» недоступен
  expect(within(roles).getByRole('checkbox', { name: /^Врач/ })).toBeDisabled()
  expect(within(roles).getByRole('button', { name: 'Сохранить роли' })).toBeDisabled()
  await user.click(within(roles).getByRole('checkbox', { name: 'Дастан Т.' }))
  await user.click(within(roles).getByRole('button', { name: 'Сохранить роли' }))
  await waitForSlow(() => expect(sent).toEqual([{ telegramId: 501, doctor: false, role: 'ASSISTANT', doctorIds: [2] }]))
  expect(await within(table).findByText('Ассистент')).toBeInTheDocument()
  expect(within(table).getByText(/Помогает: Дастан Т\./)).toBeInTheDocument()
})

test('врач (не админ): в «Персонале» только врачи; своя строка открывает «Мой профиль», там правит профиль', async () => {
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
  // Своя строка — это «Мой профиль» (одно место для своего профиля, а не вторая карточка в «Персонале»)
  expect(await screen.findByRole('heading', { name: 'Мой профиль' })).toBeInTheDocument()
  const panel = await screen.findByRole('complementary', { name: 'Врач' })
  expect(within(panel).queryByRole('textbox', { name: /Telegram id/ })).not.toBeInTheDocument()
  for (const name of ['Для пациентов', 'Работа', 'Вход']) {
    expect(within(panel).getByRole('region', { name })).toBeInTheDocument()
  }
  // Без правок «Сохранить» нет — нечего сохранять
  expect(within(panel).queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument()
  await user.type(within(panel).getByRole('textbox', { name: /Кратко/ }), 'терапевт')
  await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
  expect(await within(panel).findByText('Профиль врача сохранён')).toBeInTheDocument()
  expect(profile).toEqual({ fullName: 'Айгерим Садыкова', about: 'терапевт' })
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
  await waitForSlow(() => expect(sent).toEqual([{ serviceTypeIds: [6] }, { serviceTypeIds: [] }]))
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

test('карточка врача без Telegram: привязать номер для входа по SMS; дальше — «входит по номеру»', async () => {
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
  expect(within(panel).queryByRole('textbox', { name: /Telegram id/ })).not.toBeInTheDocument()
  expect(panel).toHaveTextContent('✓ Входит по номеру (без Telegram)')
  expect(table).toHaveTextContent('✓ по номеру')
  expect(table).toHaveTextContent('+996 700 000 022')
})

test('карточка сотрудника по номеру: телефон меняет руководитель, временный пароль; с Telegram — номер только показать', async () => {
  const puts: unknown[] = []
  let members: Schemas['StaffMembersMemberView'][] = [
    { telegramId: 111, fullName: 'Айгерим', role: 'ADMIN', me: true, doctor: true, phoneOnly: false },
    { telegramId: 5001, fullName: 'Бермет', role: 'RECEPTION', doctor: false, phoneOnly: false, phone: '+996700000041', me: false },
    { telegramId: -1000000000000001, fullName: 'Нурия', role: 'RECEPTION', doctor: false, phoneOnly: true, phone: '+996700000011', me: false },
  ]
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json(doctors)),
    http.get('*/api/members', () => HttpResponse.json(members)),
    http.get('*/api/shifts/weekly/:id', ({ params }) => HttpResponse.json({ telegramId: Number(params.id), custom: false, days: [] } satisfies Schemas['ShiftServiceWeekly'])),
    http.put('*/api/members/:id/phone', async ({ request, params }) => {
      const body = await request.json() as Schemas['StaffMembersControllerPhoneChange']
      puts.push({ id: String(params.id), ...body })
      if (body.phone === '+996 700000041') {
        return HttpResponse.json({ status: 409, code: 'phone-taken', detail: 'Этот номер уже у другого сотрудника' }, { status: 409 })
      }
      members = members.map((m) => (m.telegramId === -1000000000000001 ? { ...m, phone: '+996700000012' } : m))
      return HttpResponse.json({ phone: '+996700000012', phoneOnly: true } satisfies Schemas['StaffPhonesPhoneView'])
    }),
    http.put('*/api/members/:id/temporary-password', () => new HttpResponse(null, { status: 204 })),
  )
  const user = userEvent.setup()
  renderApp()
  openItem('members')
  const table = await screen.findByRole('table', { name: 'Персонал' })
  expect(table).toHaveTextContent('✓ по номеру')
  expect(table).toHaveTextContent('+996 700 000 041')

  await user.click(within(table).getByRole('button', { name: 'Бермет' }))
  let card = await screen.findByRole('complementary', { name: 'Сотрудник' })
  expect(card).toHaveTextContent('Номер для входа сотрудник указывает сам')
  expect(within(card).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Временный пароль' })).not.toBeInTheDocument()

  await user.click(within(table).getByRole('button', { name: 'Нурия' }))
  card = await screen.findByRole('complementary', { name: 'Сотрудник' })
  await waitForSlow(() => expect(card).toHaveTextContent('Нурия'))
  expect(card).toHaveTextContent('✓ Входит по номеру (без Telegram)')
  expect(within(card).getByRole('button', { name: 'Временный пароль' })).toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: 'Изменить' }))
  const form = within(card).getByRole('form', { name: 'Телефон: Нурия' })
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
