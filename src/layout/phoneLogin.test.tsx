import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

afterEach(() => {
  vi.useRealTimers()
})

test('вход по номеру: «Получить код» → код из SMS (one-time-code) → CRM; повторная отправка — через 60 с', async () => {
  let session = false
  const posts: { path: string; body: unknown; header: string | null }[] = []
  server.use(
    http.get('*/api/patient/me', () => (session ? HttpResponse.json(me) : HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', botId: 123456, smsLogin: true })),
    http.post('*/web/login/phone/code', async ({ request }) => {
      posts.push({ path: 'code', body: await request.json(), header: request.headers.get('X-Dental-Web') })
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/web/login/phone', async ({ request }) => {
      const body = await request.json() as { code: string }
      posts.push({ path: 'login', body, header: request.headers.get('X-Dental-Web') })
      if (body.code !== '123456') return HttpResponse.json({ detail: 'Код не подошёл или устарел. Запросите новый' }, { status: 401 })
      session = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.Telegram = { Login: { auth: vi.fn() } }
  window.history.replaceState(null, '', '/login')
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Войти по номеру телефона' }))
  expect(screen.queryByRole('button', { name: 'Войти через Telegram' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '0700 000 011')
  await user.click(screen.getByRole('button', { name: 'Получить код' }))

  const code = await screen.findByRole('textbox', { name: 'Код из SMS' })
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  expect(code).toHaveAttribute('inputmode', 'numeric')
  expect(screen.getByRole('button', { name: /Отправить ещё раз через \d+ с/ })).toBeDisabled()

  await user.type(code, '000000')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Код не подошёл или устарел')
  await user.clear(code)
  await user.type(code, '123456')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(window.location.pathname).toBe('/')
  expect(posts[0]).toEqual({ path: 'code', body: { phone: '0700 000 011' }, header: '1' })
  expect(posts.at(-1)).toEqual({ path: 'login', body: { phone: '0700 000 011', code: '123456' }, header: '1' })
  // Номер — не в адресе и не в localStorage
  expect(window.location.href).not.toContain('700')
  expect(JSON.stringify({ ...localStorage })).not.toContain('700')
  delete window.Telegram
})

test('нет бота, но SMS включены — сразу форма номера; ответ 503 — «пока не подключён»', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 })),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: null, botId: null, smsLogin: true })),
    http.post('*/web/login/phone/code', () => HttpResponse.json({ detail: 'Вход по SMS пока не подключён' }, { status: 503 })),
  )
  window.history.replaceState(null, '', '/login')
  const user = userEvent.setup()
  renderApp()
  // Без бота — сразу форма номера, без ошибки «вход недоступен»
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '700000011')
  await user.click(screen.getByRole('button', { name: 'Получить код' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Вход по SMS пока не подключён')

})

test('без smsLogin — только Telegram', async () => {
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 })),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', botId: 123456, smsLogin: false })),
  )
  window.Telegram = { Login: { auth: vi.fn() } }
  window.history.replaceState(null, '', '/login')
  renderApp()
  expect(await screen.findByRole('button', { name: 'Войти через Telegram' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Войти по номеру телефона/ })).not.toBeInTheDocument()
  delete window.Telegram
})
