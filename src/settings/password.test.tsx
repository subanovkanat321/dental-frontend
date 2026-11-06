import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type State = Schemas['PasswordControllerPasswordState']

/** Сотрудник входит по номеру (вымышленный); пароль «Тишина2026». */
function backend(state: State) {
  const changes: Schemas['PasswordControllerPasswordChange'][] = []
  let codes = 0
  const channels: unknown[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/password', () => HttpResponse.json(state)),
    http.get('*/api/me/phone', () => HttpResponse.json({ phone: state.phoneLogin ? '+996700000031' : undefined, phoneOnly: false, sms: false, telegram: false })),
    http.post('*/api/me/password/code', async ({ request }) => {
      channels.push(await request.json().catch(() => null))
      codes++
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('*/api/me/password', async ({ request }) => {
      const body = await request.json() as Schemas['PasswordControllerPasswordChange']
      changes.push(body)
      if (body.currentPassword && body.currentPassword !== 'Тишина2026') {
        return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'currentPassword', message: 'Текущий пароль не подошёл' }] }, { status: 422 })
      }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings/profile'
  return { changes, codes: () => codes, channels }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Пароль и вход»: сменить по текущему паролю; неверный текущий — ошибка под формой', async () => {
  const { changes } = backend({ phoneLogin: true, passwordSet: true, temporary: false, sms: true, setAt: '2026-11-01T06:00:00Z' })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Пароль и вход' })
  expect(section).toHaveTextContent('Вы входите по номеру и паролю')
  await user.click(within(section).getByRole('button', { name: 'Сменить пароль' }))
  await user.type(within(section).getByLabelText('Текущий пароль'), 'не-тот')
  await user.type(within(section).getByLabelText('Новый пароль'), 'Новый-пароль-1')
  await user.type(within(section).getByLabelText('Повторите пароль'), 'Новый-пароль-1')
  await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
  expect(await within(section).findByRole('alert')).toHaveTextContent('Текущий пароль не подошёл')

  await user.clear(within(section).getByLabelText('Текущий пароль'))
  await user.type(within(section).getByLabelText('Текущий пароль'), 'Тишина2026')
  await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByText(/На других устройствах нужно войти заново/)).toBeInTheDocument()
  expect(changes.at(-1)).toEqual({ currentPassword: 'Тишина2026', newPassword: 'Новый-пароль-1' })
})

test('«Не помню текущий» — код из SMS на свой номер и новый пароль', async () => {
  const { changes, codes } = backend({ phoneLogin: true, passwordSet: true, temporary: false, sms: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Пароль и вход' })
  await user.click(within(section).getByRole('button', { name: 'Сменить пароль' }))
  await user.click(within(section).getByRole('button', { name: 'Не помню текущий — подтвердить кодом из SMS' }))
  await user.click(within(section).getByRole('button', { name: 'Получить код' }))
  await user.type(await within(section).findByRole('textbox', { name: 'Код из SMS' }), '123456')
  await user.type(within(section).getByLabelText('Новый пароль'), '12345678')
  await user.type(within(section).getByLabelText('Повторите пароль'), '12345678')
  await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
  // Слабый — до сервера не уходит
  expect(within(section).getByRole('alert')).toHaveTextContent('только из цифр')
  expect(changes).toEqual([])
  await user.clear(within(section).getByLabelText('Новый пароль'))
  await user.clear(within(section).getByLabelText('Повторите пароль'))
  await user.type(within(section).getByLabelText('Новый пароль'), 'Новый-пароль-2')
  await user.type(within(section).getByLabelText('Повторите пароль'), 'Новый-пароль-2')
  await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByText(/Пароль сохранён/)).toBeInTheDocument()
  expect(codes()).toBe(1)
  expect(changes).toEqual([{ code: '123456', newPassword: 'Новый-пароль-2' }])
})

test('телефон не указан — блока «Пароль и вход» нет', async () => {
  backend({ phoneLogin: false, passwordSet: false, temporary: false, sms: false })
  renderApp()
  expect(await screen.findByRole('region', { name: 'Телефон' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Пароль и вход' })).not.toBeInTheDocument()
})

test('сотрудник с Telegram без пароля: «Задать пароль» — «Код в Telegram» (бесплатно) или по SMS', async () => {
  const { changes, channels } = backend({ phoneLogin: true, passwordSet: false, temporary: false, sms: true, telegram: true, telegramCode: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Пароль и вход' })
  expect(section).toHaveTextContent('На сайт теперь входят только по номеру и паролю')
  await user.click(within(section).getByRole('button', { name: 'Задать пароль' }))
  expect(within(section).getByRole('button', { name: 'Код по SMS' })).toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: 'Код в Telegram' }))
  await user.type(await within(section).findByRole('textbox', { name: 'Код из Telegram' }), '654321')
  await user.type(within(section).getByLabelText('Новый пароль'), 'Новый-пароль-3')
  await user.type(within(section).getByLabelText('Повторите пароль'), 'Новый-пароль-3')
  await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByText(/Пароль сохранён/)).toBeInTheDocument()
  expect(channels).toEqual([{ channel: 'telegram' }])
  expect(changes).toEqual([{ code: '654321', newPassword: 'Новый-пароль-3' }])
})

test('баннер в CRM «Задайте пароль для входа на сайте» — у сотрудника с Telegram без пароля; «Задать» → профиль', async () => {
  backend({ phoneLogin: false, passwordSet: false, temporary: false, sms: false, telegram: true })
  window.location.hash = ''
  const user = userEvent.setup()
  renderApp()
  const banner = await screen.findByRole('button', { name: /Задайте пароль для входа на сайте/ })
  await user.click(banner)
  expect(window.location.hash).toBe('#/settings/profile')
  expect(await screen.findByRole('region', { name: 'Телефон' })).toBeInTheDocument()
})

test('баннера нет, если пароль задан', async () => {
  backend({ phoneLogin: true, passwordSet: true, temporary: false, sms: false, telegram: true })
  window.location.hash = ''
  renderApp()
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Задайте пароль/ })).not.toBeInTheDocument()
})
