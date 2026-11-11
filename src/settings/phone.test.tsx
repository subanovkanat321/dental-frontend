import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

type Phone = Schemas['MyPhoneControllerMyPhone']

/** Регистратор с Telegram, без кресла врача; номер и код вымышленные. */
function backend(initial: Phone) {
  let state = initial
  const codes: unknown[] = []
  const confirms: unknown[] = []
  const passwords: unknown[] = []
  let removed = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/phone', () => HttpResponse.json(state)),
    http.post('*/api/me/phone/code', async ({ request }) => {
      codes.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('*/api/me/phone', async ({ request }) => {
      const body = await request.json() as Schemas['MyPhoneControllerPhoneConfirm']
      confirms.push(body)
      if (body.code !== '123456') {
        return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'code', message: 'Код не подошёл или устарел. Запросите новый' }] }, { status: 422 })
      }
      state = { ...state, phone: '+996700000051' }
      return HttpResponse.json({ state, setupToken: 'tok-5' } satisfies Schemas['MyPhoneControllerPhoneConfirmed'])
    }),
    http.put('*/api/me/password', async ({ request }) => {
      passwords.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('*/api/me/phone', () => {
      removed++
      state = { ...state, phone: undefined }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings/profile'
  return { codes, confirms, passwords, removed: () => removed }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Мой профиль»: номер по SMS — «Получить код» → код → «Подтвердить» → потом «Придумайте пароль»; убрать — без кода', async () => {
  const { codes, confirms, passwords, removed } = backend({ phoneOnly: false, sms: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()

  await user.click(within(section).getByRole('button', { name: 'Указать телефон' }))
  const form = within(section).getByRole('form', { name: 'Мой телефон' })
  await user.type(within(form).getByRole('textbox', { name: 'Телефон' }), '700000051')
  await user.click(within(form).getByRole('button', { name: 'Получить код' }))
  const confirm = await within(section).findByRole('form', { name: 'Подтвердить номер' })
  expect(codes).toEqual([{ phone: '+996 700000051' }])
  expect(confirm).toHaveTextContent('Отправили SMS с кодом на +996 700 000 051')
  // Пароля на шаге кода нет
  expect(within(section).queryByLabelText('Пароль для входа по номеру')).not.toBeInTheDocument()

  // Неверный код — номер не привязан, ошибка под полем
  await user.type(within(confirm).getByRole('textbox', { name: 'Код подтверждения' }), '000000')
  await user.click(within(confirm).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(confirm).findByRole('alert')).toHaveTextContent('Код не подошёл')
  await user.clear(within(confirm).getByRole('textbox', { name: 'Код подтверждения' }))
  await user.type(within(confirm).getByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.click(within(confirm).getByRole('button', { name: 'Подтвердить' }))
  expect(confirms).toEqual([{ phone: '+996 700000051', code: '000000' }, { phone: '+996 700000051', code: '123456' }])

  // Номер подтверждён — теперь пароль, с пропуском из ответа
  const step = await within(section).findByRole('form', { name: 'Придумайте пароль для входа по номеру' })
  expect(step).toHaveTextContent('подтверждён')
  await user.type(within(step).getByLabelText('Пароль для входа по номеру'), 'Тишина2026')
  await user.type(within(step).getByLabelText('Повторите пароль'), 'Тишина2026')
  await user.click(within(step).getByRole('button', { name: 'Сохранить пароль' }))
  expect(await within(section).findByText('+996 700 000 051')).toBeInTheDocument()
  expect(passwords).toEqual([{ setupToken: 'tok-5', newPassword: 'Тишина2026' }])

  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(within(section).getByRole('button', { name: 'Убрать номер' }))
  await waitForSlow(() => expect(removed()).toBe(1))
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
})

test('«Мой профиль»: шаг пароля после подтверждения номера можно пропустить', async () => {
  const { passwords } = backend({ phoneOnly: false, sms: true })
  // Сообщения (notify) отвечаются через подменённый window.confirm (test/setup.ts)
  const asked = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  await user.click(await within(section).findByRole('button', { name: 'Указать телефон' }))
  await user.type(within(section).getByRole('textbox', { name: 'Телефон' }), '700000051')
  await user.click(within(section).getByRole('button', { name: 'Получить код' }))
  await user.type(await within(section).findByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.click(within(section).getByRole('button', { name: 'Подтвердить' }))
  await user.click(await within(section).findByRole('button', { name: 'Пропустить' }))
  expect(await within(section).findByText('+996 700 000 051')).toBeInTheDocument()
  expect(passwords).toEqual([])
  await waitForSlow(() => expect(asked).toHaveBeenCalledWith(expect.stringContaining('можно задать позже')))
})

test('«Мой профиль»: SMS не подключены — номер для входа не задать', async () => {
  backend({ phoneOnly: false, sms: false })
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('SMS не подключены — номер для входа сейчас не задать.')).toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: 'Указать телефон' })).not.toBeInTheDocument()
})

test('«Мой профиль»: без Telegram номер — единственный вход: сменить можно, убрать нельзя', async () => {
  backend({ phone: '+996700000052', phoneOnly: true, sms: true })
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('+996 700 000 052')).toBeInTheDocument()
  expect(section).toHaveTextContent('Без Telegram это ваш единственный вход')
  expect(within(section).getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: 'Убрать номер' })).not.toBeInTheDocument()
})

test('«Подтвердить через Telegram» в Mini App: Telegram отдаёт номер боту — номер появляется без SMS', async () => {
  const { codes } = backend({ phoneOnly: false, sms: true, telegram: true })
  let requested = 0
  window.Telegram = { WebApp: {
    initData: 'signed', ready() {}, expand() {}, isVersionAtLeast: () => true,
    requestContact(callback: (shared: boolean) => void) {
      requested++
      // Бот получил контакт и привязал номер (StaffPhoneShare на сервере)
      server.use(http.get('*/api/me/phone', () => HttpResponse.json({ phone: '+996700000052', phoneOnly: false, sms: true, telegram: true })))
      callback(true)
    },
  } } as unknown as typeof window.Telegram
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  await user.click(await within(section).findByRole('button', { name: 'Подтвердить через Telegram' }))
  expect(await within(section).findByText('+996 700 000 052', {}, { timeout: 5000 })).toBeInTheDocument()
  expect(requested).toBe(1)
  expect(codes).toEqual([])
  delete window.Telegram
})

test('«Подтвердить через Telegram» на сайте — ссылка на бота с кнопкой «Поделиться номером»', async () => {
  backend({ phoneOnly: false, sms: false, telegram: true })
  server.use(http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', smsLogin: false, passwordLogin: true, telegramCode: true })))
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(within(section).queryByText(/SMS не подключены/)).not.toBeInTheDocument()
  const button = await within(section).findByRole('button', { name: 'Подтвердить через Telegram' })
  await waitForSlow(async () => {
    await user.click(button)
    expect(open).toHaveBeenCalledWith('https://t.me/tish_test_bot?start=phone', '_blank', 'noopener,noreferrer')
  })
  expect(within(section).getByRole('status')).toHaveTextContent('«📱 Поделиться номером»')
})
