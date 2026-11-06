import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Phone = Schemas['MyPhoneControllerMyPhone']

/** Регистратор с Telegram, без кресла врача; номер и код вымышленные. */
function backend(initial: Phone) {
  let state = initial
  const codes: unknown[] = []
  const confirms: unknown[] = []
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
      return HttpResponse.json(state)
    }),
    http.delete('*/api/me/phone', () => {
      removed++
      state = { ...state, phone: undefined }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings/profile'
  return { codes, confirms, removed: () => removed }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Мой профиль»: номер для входа — только с кодом из SMS: «Получить код» → код → «Подтвердить»; убрать — без кода', async () => {
  const { codes, confirms, removed } = backend({ phoneOnly: false, sms: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
  expect(section).toHaveTextContent('По этому номеру можно войти на сайте без Telegram: код из SMS, потом свой пароль.')

  await user.click(within(section).getByRole('button', { name: 'Указать телефон' }))
  const form = within(section).getByRole('form', { name: 'Мой телефон' })
  await user.type(within(form).getByRole('textbox', { name: 'Телефон' }), '700000051')
  await user.click(within(form).getByRole('button', { name: 'Получить код' }))
  const confirm = await within(section).findByRole('form', { name: 'Подтвердить номер' })
  expect(codes).toEqual([{ phone: '+996 700000051' }])
  expect(confirm).toHaveTextContent('Код отправлен на +996 700 000 051')

  // Неверный код — номер не привязан, ошибка под полем
  await user.type(within(confirm).getByRole('textbox', { name: 'Код из SMS' }), '000000')
  await user.click(within(confirm).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(confirm).findByRole('alert')).toHaveTextContent('Код не подошёл')
  expect(within(section).queryByText('+996 700 000 051')).not.toBeInTheDocument()

  await user.clear(within(confirm).getByRole('textbox', { name: 'Код из SMS' }))
  await user.type(within(confirm).getByRole('textbox', { name: 'Код из SMS' }), '123456')
  await user.click(within(confirm).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(section).findByText('+996 700 000 051')).toBeInTheDocument()
  expect(confirms).toEqual([{ phone: '+996 700000051', code: '000000' }, { phone: '+996 700000051', code: '123456' }])

  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(within(section).getByRole('button', { name: 'Убрать номер' }))
  await vi.waitFor(() => expect(removed()).toBe(1))
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
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
