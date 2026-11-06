import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Phone = Schemas['StaffPhonesPhoneView']

/** Регистратор с Telegram, без кресла врача; номер вымышленный. */
function backend(initial: Phone) {
  let state = initial
  const puts: unknown[] = []
  let removed = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/phone', () => HttpResponse.json(state)),
    http.put('*/api/me/phone', async ({ request }) => {
      const body = await request.json() as Schemas['MyPhoneControllerPhoneChange']
      puts.push(body)
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
  return { puts, removed: () => removed }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Мой профиль»: телефон для входа — у сотрудника и без кресла врача; указать и убрать', async () => {
  const { puts, removed } = backend({ phoneOnly: false })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
  expect(section).toHaveTextContent('По этому номеру можно войти на сайте без Telegram: код из SMS, потом свой пароль.')

  await user.click(within(section).getByRole('button', { name: 'Указать телефон' }))
  const form = within(section).getByRole('form', { name: 'Мой телефон' })
  await user.type(within(form).getByRole('textbox', { name: 'Телефон' }), '700000051')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(section).findByText('+996 700 000 051')).toBeInTheDocument()
  expect(puts).toEqual([{ phone: '+996 700000051' }])

  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await user.click(within(section).getByRole('button', { name: 'Убрать номер' }))
  await vi.waitFor(() => expect(removed()).toBe(1))
  expect(await within(section).findByText('Телефон не указан.')).toBeInTheDocument()
})

test('«Мой профиль»: без Telegram номер — единственный вход: сменить можно, убрать нельзя', async () => {
  backend({ phone: '+996700000052', phoneOnly: true })
  renderApp()
  const section = await screen.findByRole('region', { name: 'Телефон' })
  expect(await within(section).findByText('+996 700 000 052')).toBeInTheDocument()
  expect(section).toHaveTextContent('Без Telegram это ваш единственный вход')
  expect(within(section).getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: 'Убрать номер' })).not.toBeInTheDocument()
})
