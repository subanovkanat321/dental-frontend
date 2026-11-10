import { act, screen, within } from '@testing-library/react'
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
    http.post('*/api/me/password/confirm', async ({ request }) => {
      const body = await request.json() as Schemas['PasswordControllerCodeConfirm']
      if (body.code !== '123456') {
        return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'code', message: 'Код не подошёл или устарел. Запросите новый' }] }, { status: 422 })
      }
      return HttpResponse.json({ setupToken: 'tok-9' } satisfies Schemas['PasswordControllerSetupToken'])
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

test('«Не помню текущий» — «Получить код» → код → «Подтвердить» → только потом новый пароль (с пропуском)', async () => {
  const { changes, codes } = backend({ phoneLogin: true, passwordSet: true, temporary: false, sms: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Пароль и вход' })
  await user.click(within(section).getByRole('button', { name: 'Сменить пароль' }))
  await user.click(within(section).getByRole('button', { name: 'Не помню текущий — подтвердить кодом' }))
  expect(within(section).queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: 'Получить код' }))
  const code = await within(section).findByRole('textbox', { name: 'Код подтверждения' })
  // Пароль — только после «Подтвердить»
  expect(within(section).queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  await user.type(code, '000000')
  await user.click(within(section).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(section).findByRole('alert')).toHaveTextContent('Код не подошёл')
  expect(within(section).queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  await user.clear(code)
  await user.type(code, '123456')
  await user.click(within(section).getByRole('button', { name: 'Подтвердить' }))

  await user.type(await within(section).findByLabelText('Новый пароль'), '12345678')
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
  expect(changes).toEqual([{ setupToken: 'tok-9', newPassword: 'Новый-пароль-2' }])
})

test('телефон не указан — блока «Пароль и вход» нет', async () => {
  backend({ phoneLogin: false, passwordSet: false, temporary: false, sms: false })
  renderApp()
  expect(await screen.findByRole('region', { name: 'Телефон' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Пароль и вход' })).not.toBeInTheDocument()
})

test('сотрудник с Telegram без пароля: одна кнопка «Получить код» (сервер: сначала Telegram), SMS — через 60 с', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const { changes, channels } = backend({ phoneLogin: true, passwordSet: false, temporary: false, sms: true, telegram: true, telegramCode: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp()
    const section = await screen.findByRole('region', { name: 'Пароль и вход' })
    expect(section).toHaveTextContent('На сайт теперь входят только по номеру и паролю')
    await user.click(within(section).getByRole('button', { name: 'Задать пароль' }))
    expect(within(section).queryByRole('button', { name: 'Код в Telegram' })).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Код по SMS' })).not.toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Получить код' }))
    await within(section).findByRole('textbox', { name: 'Код подтверждения' })
    expect(section).toHaveTextContent('Отправили код: в Telegram (от бота клиники), если номер привязан к вашему Telegram, иначе — SMS на этот номер.')
    expect(within(section).queryByRole('button', { name: 'Не пришло? Отправить по SMS' })).not.toBeInTheDocument()
    for (let i = 0; i < 60; i++) await act(async () => { vi.advanceTimersByTime(1000) })
    await user.click(within(section).getByRole('button', { name: 'Не пришло? Отправить по SMS' }))
    expect(await within(section).findByText(/Отправили SMS с кодом/)).toBeInTheDocument()

    await user.type(within(section).getByRole('textbox', { name: 'Код подтверждения' }), '123456')
    await user.click(within(section).getByRole('button', { name: 'Подтвердить' }))
    await user.type(await within(section).findByLabelText('Новый пароль'), 'Новый-пароль-3')
    await user.type(within(section).getByLabelText('Повторите пароль'), 'Новый-пароль-3')
    await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
    expect(await screen.findByText(/Пароль сохранён/)).toBeInTheDocument()
    expect(channels).toEqual([{}, { channel: 'sms' }])
    expect(changes).toEqual([{ setupToken: 'tok-9', newPassword: 'Новый-пароль-3' }])
  } finally {
    vi.useRealTimers()
  }
})

test('баннер в CRM «Чтобы входить без Telegram, задайте пароль» — у сотрудника с Telegram без пароля; «Задать» → профиль', async () => {
  backend({ phoneLogin: false, passwordSet: false, temporary: false, sms: false, telegram: true })
  window.location.hash = ''
  const user = userEvent.setup()
  renderApp()
  const banner = await screen.findByRole('button', { name: /Чтобы входить без Telegram, задайте пароль/ })
  await user.click(banner)
  expect(window.location.hash).toBe('#/me/profile')
  expect(await screen.findByRole('region', { name: 'Телефон' })).toBeInTheDocument()
})

test('баннера нет, если пароль задан', async () => {
  backend({ phoneLogin: true, passwordSet: true, temporary: false, sms: false, telegram: true })
  window.location.hash = ''
  renderApp()
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Задайте пароль/ })).not.toBeInTheDocument()
})

test('перезагрузили, пока ходили за кодом в Telegram, — «Пароль и вход» сразу на шаге кода', async () => {
  const { changes, codes } = backend({ phoneLogin: true, passwordSet: true, temporary: false, sms: true })
  server.use(http.get('*/api/me/password/code', () => HttpResponse.json(
    { pending: true, secondsLeft: 200, resendSeconds: 20 } satisfies Schemas['PasswordControllerCodePending'])))
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Пароль и вход' })
  const code = await within(section).findByRole('textbox', { name: 'Код подтверждения' })
  // Отсчёт — оставшийся, код заново не запрашивали
  expect(section).toHaveTextContent(/Через (20|19) с можно отправить по SMS/)
  await user.type(code, '123456')
  await user.click(within(section).getByRole('button', { name: 'Подтвердить' }))
  await user.type(await within(section).findByLabelText('Новый пароль'), 'Новый-пароль-3')
  await user.type(within(section).getByLabelText('Повторите пароль'), 'Новый-пароль-3')
  await user.click(within(section).getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByText(/Пароль сохранён/)).toBeInTheDocument()
  expect(codes()).toBe(0)
  expect(changes).toEqual([{ setupToken: 'tok-9', newPassword: 'Новый-пароль-3' }])
})
