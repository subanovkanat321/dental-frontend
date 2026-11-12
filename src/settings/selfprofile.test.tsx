import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Всё о себе сотрудник заполняет сам (админ только приглашает). Имена и номера — вымышленные. */
const reception: Schemas['BookingViewsMe'] = { ...me, doctorId: undefined, admin: false, reception: true }
const phone = { phoneOnly: false, sms: true, telegram: true } satisfies Schemas['MyPhoneControllerMyPhone']

beforeEach(() => {
  localStorage.clear()
  server.use(
    http.get('*/api/me/phone', () => HttpResponse.json(phone)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
})
afterEach(() => {
  window.location.hash = ''
})

test('«Мой профиль» у регистратуры: сверху своё «Имя» — меняет сама, ниже «Телефон», «Пароль и вход» — в самом низу', async () => {
  let sent: unknown = null
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(reception)),
    http.get('*/api/me/password', () => HttpResponse.json({ phoneLogin: true, passwordSet: true, temporary: false, sms: false, telegram: false, telegramCode: false } satisfies Schemas['PasswordControllerPasswordState'])),
    http.get('*/api/me/name', () => HttpResponse.json({ fullName: 'Айпери', editable: true } satisfies Schemas['StaffMembersOwnName'])),
    http.put('*/api/me/name', async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ fullName: 'Айпери Исакова', editable: true } satisfies Schemas['StaffMembersOwnName'])
    }),
  )
  window.location.hash = '/settings/profile'
  const user = userEvent.setup()
  renderApp()

  const nameBlock = await screen.findByRole('region', { name: 'Имя' })
  const order = await Promise.all(['Имя', 'Телефон', 'Пароль и вход'].map((name) => screen.findByRole('region', { name })))
  expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  const input = await within(nameBlock).findByRole('textbox', { name: 'Имя' })
  expect(input).toHaveValue('Айпери')
  await user.clear(input)
  await user.type(input, 'Айпери Исакова')
  await user.click(within(nameBlock).getByRole('button', { name: 'Сохранить' }))
  expect(await within(nameBlock).findByText('Имя сохранено')).toBeInTheDocument()
  expect(sent).toEqual({ fullName: 'Айпери Исакова' })
  // Карточки врача у регистратуры нет
  expect(screen.queryByRole('complementary', { name: 'Врач' })).not.toBeInTheDocument()
})

test('«Мой профиль» у врача: карточка с разделами, своё фото и «о себе» — можно менять', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json([{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false }] satisfies Schemas['DoctorAdminView'][])),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
  )
  window.location.hash = '/settings/profile'
  renderApp()
  const card = await screen.findByRole('complementary', { name: 'Врач' })
  for (const name of ['Для пациентов', 'Работа', 'Вход и права']) {
    expect(within(card).getByRole('region', { name })).toBeInTheDocument()
  }
  const patients = within(card).getByRole('region', { name: 'Для пациентов' })
  expect(within(patients).getByRole('textbox', { name: 'Имя' })).toHaveValue('Айгерим Садыкова')
  expect(within(patients).getByLabelText('Фото врача')).toBeInTheDocument()
  expect(patients).not.toHaveTextContent('врач заполняет сам')
  // Своё имя врача — в карточке, отдельного блока «Имя» нет
  expect(screen.queryByRole('form', { name: 'Моё имя' })).not.toBeInTheDocument()
})

test('подсказка «Заполните свой профиль»: врачу без фото и «о себе» — ведёт в профиль; ✕ — больше не показываем', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(me)))
  const user = userEvent.setup()
  const { unmount } = renderApp()
  const notice = await screen.findByRole('region', { name: 'Заполните профиль' })
  expect(notice).toHaveTextContent('Заполните свой профиль — его видят пациенты')
  await user.click(within(notice).getByRole('button', { name: 'Скрыть подсказку' }))
  expect(screen.queryByRole('region', { name: 'Заполните профиль' })).not.toBeInTheDocument()
  // Запомнили без личных данных
  expect(localStorage.getItem('crm.profile-notice.hidden')).toBe('1')
  unmount()
  renderApp()
  await screen.findByRole('button', { name: /Расписание/ })
  expect(screen.queryByRole('region', { name: 'Заполните профиль' })).not.toBeInTheDocument()
})

test('подсказки нет, когда профиль заполнен; сотруднику без имени — «укажите имя» → «Изменить профиль»', async () => {
  const filled = { ...me, doctors: [{ id: 1, fullName: 'Айгерим Садыкова', active: true, about: 'терапевт', photoUrl: '/doctors/1/photo?v=1' }] }
  server.use(http.get('*/api/patient/me', () => HttpResponse.json(filled)))
  const { unmount } = renderApp()
  await screen.findByRole('button', { name: /Расписание/ })
  expect(screen.queryByRole('region', { name: 'Заполните профиль' })).not.toBeInTheDocument()
  unmount()

  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(reception)),
    http.get('*/api/me/name', () => HttpResponse.json({ editable: true } satisfies Schemas['StaffMembersOwnName'])),
  )
  const user = userEvent.setup()
  renderApp()
  const notice = await screen.findByRole('region', { name: 'Заполните профиль' })
  expect(notice).toHaveTextContent('укажите имя')
  await user.click(within(notice).getByRole('button', { name: /укажите имя/ }))
  expect(window.location.hash).toBe('#/me/profile')
})

test('«Мой профиль» у врача: сверху «Для пациентов» (фото и имя), ниже «Телефон» и «Работа»; «Удалить врача» и «Работает» у себя — нет', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/doctors/admin', () => HttpResponse.json([{ id: 1, fullName: 'Айгерим Садыкова', active: true, telegramId: 111, role: 'ADMIN', phoneOnly: false }] satisfies Schemas['DoctorAdminView'][])),
    http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: [] } satisfies Schemas['DoctorHoursView'])),
  )
  window.location.hash = '/settings/profile'
  renderApp()
  const card = await screen.findByRole('complementary', { name: 'Врач' })
  const order = await Promise.all(['Для пациентов', 'Телефон', 'Работа', 'Вход и права'].map((name) => within(card).findByRole('region', { name })))
  for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(order[0]!).getByText('Айгерим Садыкова', { selector: 'strong' })).toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Удалить врача' })).not.toBeInTheDocument()
  expect(within(card).queryByRole('checkbox', { name: /Работает/ })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Выход' })).toBeInTheDocument()
})
