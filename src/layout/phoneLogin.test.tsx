import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Номер и пароли — вымышленные. */
const WRONG = 'Неверный номер или пароль. Пароль ещё не задан или забыли — войдите по SMS-коду'

type Post = { path: string; body: Record<string, unknown>; header: string | null }

/**
 * Фальшивый вход по номеру: пароль «Тишина2026» (или временный «Временный-1»), SMS-код 123456,
 * пропуск «tok-1». Возвращает список запросов — проверить, что ушло на сервер.
 */
function backend(config: { sms?: boolean; password?: boolean; bot?: boolean } = {}) {
  let session = false
  const posts: Post[] = []
  const record = async (path: string, request: Request) => {
    const body = await request.json() as Record<string, unknown>
    posts.push({ path, body, header: request.headers.get('X-Dental-Web') })
    return body
  }
  server.use(
    http.get('*/api/patient/me', () => (session ? HttpResponse.json(me) : HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))),
    http.get('*/web/config', () => HttpResponse.json({
      botUsername: config.bot === false ? null : 'tish_test_bot', botId: config.bot === false ? null : 123456,
      smsLogin: config.sms ?? true, passwordLogin: config.password ?? true,
    })),
    http.post('*/web/login/phone/code', async ({ request }) => {
      await record('code', request)
      return config.sms === false ? HttpResponse.json({ detail: 'Вход по SMS пока не подключён' }, { status: 503 }) : new HttpResponse(null, { status: 204 })
    }),
    http.post('*/web/login/phone', async ({ request }) => {
      const body = await record('verify', request)
      if (body.code !== '123456') return HttpResponse.json({ detail: 'Код не подошёл или устарел. Запросите новый' }, { status: 401 })
      return HttpResponse.json({ setupToken: 'tok-1', temporary: false })
    }),
    http.post('*/web/login/phone/password', async ({ request }) => {
      const body = await record('password', request)
      if (body.password === 'Тишина2026') {
        session = true
        return new HttpResponse(null, { status: 204 })
      }
      if (body.password === 'Временный-1') return HttpResponse.json({ setupToken: 'tok-1', temporary: true })
      if (body.password === 'много') return HttpResponse.json({ detail: 'Слишком много неверных попыток. Подождите 15 минут или войдите по SMS-коду' }, { status: 429 })
      return HttpResponse.json({ detail: WRONG }, { status: 401 })
    }),
    http.post('*/web/login/phone/password/new', async ({ request }) => {
      const body = await record('new', request)
      if (body.token !== 'tok-1') return HttpResponse.json({ detail: 'Подтверждение устарело — войдите по SMS-коду ещё раз' }, { status: 401 })
      session = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.Telegram = { Login: { auth: vi.fn() } }
  window.history.replaceState(null, '', '/login')
  return posts
}

afterEach(() => {
  delete window.Telegram
})

test('по умолчанию — «номер + пароль»: вошли, номер и пароль только в теле запроса', async () => {
  const posts = backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Войти по номеру телефона' }))
  expect(screen.queryByRole('button', { name: 'Войти через Telegram' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '0700 000 031')
  const password = screen.getByLabelText('Пароль')
  expect(password).toHaveAttribute('type', 'password')
  expect(password).toHaveAttribute('autocomplete', 'current-password')
  await user.type(password, 'Тишина2026')
  // Показать/скрыть
  await user.click(screen.getByRole('button', { name: 'Показать пароль' }))
  expect(password).toHaveAttribute('type', 'text')
  await user.click(screen.getByRole('button', { name: 'Скрыть пароль' }))
  expect(password).toHaveAttribute('type', 'password')
  await user.click(screen.getByRole('button', { name: 'Войти' }))

  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(posts).toEqual([{ path: 'password', body: { phone: '0700 000 031', password: 'Тишина2026' }, header: '1' }])
  expect(window.location.pathname).toBe('/')
  expect(window.location.href).not.toContain('700')
  expect(window.location.href).not.toContain('Тишина')
  expect(JSON.stringify({ ...localStorage })).not.toContain('Тишина')
  expect(JSON.stringify({ ...localStorage })).not.toContain('700')
})

test('неверный пароль (или пароля нет) → «Войти по SMS-коду» → код → «Придумайте пароль» → вход', async () => {
  const posts = backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Войти по номеру телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'не-тот-пароль')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(WRONG)

  // Номер не набирать заново: код уходит на тот же
  await user.click(screen.getByRole('button', { name: 'Войти по SMS-коду' }))
  const code = await screen.findByRole('textbox', { name: 'Код из SMS' })
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  expect(screen.getByRole('button', { name: /Отправить ещё раз через \d+ с/ })).toBeDisabled()
  await user.type(code, '000000')
  await user.click(screen.getByRole('button', { name: 'Дальше' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Код не подошёл')
  await user.clear(code)
  await user.type(code, '123456')
  await user.click(screen.getByRole('button', { name: 'Дальше' }))

  const form = await screen.findByRole('form', { name: 'Придумайте пароль' })
  expect(form).toHaveTextContent('Номер подтверждён')
  const fresh = screen.getByLabelText('Новый пароль')
  const repeat = screen.getByLabelText('Повторите пароль')
  expect(fresh).toHaveAttribute('autocomplete', 'new-password')
  const save = screen.getByRole('button', { name: 'Сохранить и войти' })

  // Требования — подсказки до отправки
  await user.type(fresh, '1234567')
  await user.click(save)
  expect(screen.getByRole('alert')).toHaveTextContent('не короче 8 символов')
  await user.type(fresh, '8')
  await user.click(save)
  expect(screen.getByRole('alert')).toHaveTextContent('только из цифр')
  await user.clear(fresh)
  await user.type(fresh, '+996700000031')
  await user.click(save)
  expect(screen.getByRole('alert')).toHaveTextContent('не должен совпадать с номером')
  await user.clear(fresh)
  await user.type(fresh, 'Тишина2026')
  await user.type(repeat, 'Тишина2025')
  await user.click(save)
  expect(screen.getByRole('alert')).toHaveTextContent('Пароли не совпадают')
  expect(screen.getByRole('list', { name: 'Требования к паролю' })).toHaveTextContent('✓ Не короче 8 символов')
  await user.clear(repeat)
  await user.type(repeat, 'Тишина2026')
  await user.click(screen.getByRole('button', { name: 'Показать пароль' }))
  expect(fresh).toHaveAttribute('type', 'text')
  expect(repeat).toHaveAttribute('type', 'text')
  await user.click(save)

  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(posts.map((p) => p.path)).toEqual(['password', 'code', 'verify', 'verify', 'new'])
  expect(posts[1]!.body).toEqual({ phone: '+996 700000031' })
  expect(posts.at(-1)!.body).toEqual({ token: 'tok-1', password: 'Тишина2026' })
})

test('«Первый вход или забыли пароль? Войти по SMS» и обратно; 429 — блок и предложение SMS', async () => {
  backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Войти по номеру телефона' }))
  await user.click(screen.getByRole('button', { name: 'Первый вход или забыли пароль? Войти по SMS' }))
  expect(screen.getByRole('form', { name: 'Вход по SMS-коду' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Войти по паролю' }))

  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'много')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Подождите 15 минут')
  expect(screen.getByRole('button', { name: 'Войти по SMS-коду' })).toBeInTheDocument()
})

test('временный пароль от админа → сразу «Придумайте пароль»; пропуск устарел — заново по SMS', async () => {
  const posts = backend()
  server.use(http.post('*/web/login/phone/password/new', async ({ request }) => {
    posts.push({ path: 'new', body: await request.json() as Record<string, unknown>, header: null })
    return HttpResponse.json({ detail: 'Подтверждение устарело — войдите по SMS-коду ещё раз' }, { status: 401 })
  }))
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Войти по номеру телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'Временный-1')
  await user.click(screen.getByRole('button', { name: 'Войти' }))

  expect(await screen.findByRole('form', { name: 'Придумайте пароль' })).toHaveTextContent('Временный пароль подошёл')
  await user.type(screen.getByLabelText('Новый пароль'), 'Мой-пароль-1')
  await user.type(screen.getByLabelText('Повторите пароль'), 'Мой-пароль-1')
  await user.click(screen.getByRole('button', { name: 'Сохранить и войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Подтверждение устарело')
  expect(screen.getByRole('form', { name: 'Вход по SMS-коду' })).toBeInTheDocument()
})

test('SMS не подключены — вход по паролю есть, ссылки на SMS нет, подсказка про временный пароль', async () => {
  backend({ sms: false })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Войти по номеру телефона' }))
  expect(screen.getByLabelText('Пароль')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Войти по SMS/ })).not.toBeInTheDocument()
  expect(screen.getByText(/задать временный пароль/)).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'не-тот')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(WRONG)
  expect(screen.queryByRole('button', { name: 'Войти по SMS-коду' })).not.toBeInTheDocument()
})

test('нет бота и пароля, но SMS включены — сразу форма номера; ответ 503 — «пока не подключён»', async () => {
  backend({ bot: false, password: false })
  server.use(http.post('*/web/login/phone/code', () => HttpResponse.json({ detail: 'Вход по SMS пока не подключён' }, { status: 503 })))
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '700000011')
  expect(screen.queryByRole('button', { name: 'Войти по паролю' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Получить код' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Вход по SMS пока не подключён')
})

test('без smsLogin и passwordLogin — только Telegram', async () => {
  backend({ sms: false, password: false })
  renderApp()
  expect(await screen.findByRole('button', { name: 'Войти через Telegram' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Войти по номеру телефона/ })).not.toBeInTheDocument()
})
