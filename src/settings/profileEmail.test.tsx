import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Email = Schemas['MyEmailControllerMyEmail']

/** Регистратор с Telegram и номером входа; почта и код — вымышленные. */
function backend(initial: Email) {
  let state = initial
  const codes: unknown[] = []
  const confirms: unknown[] = []
  let removed = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/phone', () => HttpResponse.json({ phone: initial.phoneLogin ? '+996700000051' : undefined, phoneOnly: false, telegram: true } satisfies Schemas['MyPhoneControllerMyPhone'])),
    http.get('*/api/me/email', () => HttpResponse.json(state)),
    http.post('*/api/me/email/code', async ({ request }) => {
      codes.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('*/api/me/email', async ({ request }) => {
      const body = await request.json() as Schemas['MyEmailControllerEmailConfirm']
      confirms.push(body)
      if (body.code !== '123456') {
        return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'code', message: 'Код не подошёл или устарел. Запросите новый' }] }, { status: 422 })
      }
      state = { ...state, email: body.email }
      return HttpResponse.json(state)
    }),
    http.delete('*/api/me/email', () => {
      removed++
      state = { ...state, email: undefined }
      return HttpResponse.json(state)
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings/profile'
  return { codes, confirms, removed: () => removed }
}

afterEach(() => {
  window.location.hash = ''
})

test('«Мой профиль → Почта»: «Добавить почту» → код из письма → «Подтвердить»; убрать — без кода', async () => {
  const { codes, confirms, removed } = backend({ email: undefined, phoneLogin: true, available: true })
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Почта' })
  expect(within(section).getByText('Почта не указана.')).toBeInTheDocument()
  // «?» — зачем почта
  await user.click(within(section).getByRole('button', { name: 'Подсказка: Почта' }))
  expect(within(section).getByRole('note')).toHaveTextContent('Почта — чтобы восстановить пароль, если нет Telegram')

  await user.click(within(section).getByRole('button', { name: 'Добавить почту' }))
  const form = within(section).getByRole('form', { name: 'Моя почта' })
  await user.type(within(form).getByRole('textbox', { name: 'Почта' }), 'Aigerim.Test@Gmail.com')
  await user.click(within(form).getByRole('button', { name: 'Получить код' }))
  const confirm = await within(section).findByRole('form', { name: 'Подтвердить почту' })
  expect(codes).toEqual([{ email: 'Aigerim.Test@Gmail.com' }])
  expect(confirm).toHaveTextContent('Отправили письмо с кодом на aigerim.test@gmail.com')
  expect(confirm).toHaveTextContent('10 минут')

  // Неверный код — почта не сохранена, ошибка под полем
  const code = within(confirm).getByRole('textbox', { name: 'Код подтверждения' })
  await user.type(code, '000000')
  await user.click(within(confirm).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(confirm).findByRole('alert')).toHaveTextContent('Код не подошёл')
  await user.clear(code)
  await user.type(code, '123456')
  await user.click(within(confirm).getByRole('button', { name: 'Подтвердить' }))
  expect(await within(section).findByText('aigerim.test@gmail.com')).toHaveClass('email-address')
  expect(confirms).toEqual([{ email: 'aigerim.test@gmail.com', code: '000000' }, { email: 'aigerim.test@gmail.com', code: '123456' }])
  // Адрес — не в адресе страницы и не в localStorage
  expect(window.location.href).not.toContain('aigerim')
  expect(JSON.stringify({ ...localStorage })).not.toContain('aigerim')

  expect(within(section).getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: 'Ещё действия с почтой' }))
  await user.click(within(section).getByRole('menuitem', { name: 'Убрать почту' }))
  await user.click(await screen.findByRole('button', { name: 'Убрать' }))
  expect(await within(section).findByText('Почта не указана.')).toBeInTheDocument()
  expect(removed()).toBe(1)
})

test('без номера входа — блок просит сначала телефон', async () => {
  backend({ email: undefined, phoneLogin: false, available: true })
  renderApp()
  const section = await screen.findByRole('region', { name: 'Почта' })
  expect(section).toHaveTextContent('Сначала укажите телефон')
  expect(within(section).queryByRole('button', { name: 'Добавить почту' })).not.toBeInTheDocument()
})

test('почта не настроена (MAIL_* пусто) — блока «Почта» нет', async () => {
  backend({ email: undefined, phoneLogin: true, available: false })
  renderApp()
  await screen.findByRole('region', { name: 'Телефон' })
  expect(screen.queryByRole('region', { name: 'Почта' })).not.toBeInTheDocument()
})
