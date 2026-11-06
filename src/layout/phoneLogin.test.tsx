import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Номер и пароли — вымышленные. */
const WRONG = 'Неверный номер или пароль. Пароль ещё не задан или забыли — нажмите «Забыли пароль? / Первый вход»'

type Post = { path: string; body: Record<string, unknown>; header: string | null }

/**
 * Фальшивый вход по номеру: пароль «Тишина2026» (или временный «Временный-1»), код 123456 (из Telegram
 * или SMS), пропуск «tok-1». Возвращает список запросов — проверить, что ушло на сервер.
 */
function backend(config: { sms?: boolean; password?: boolean; telegram?: boolean } = {}) {
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
      botUsername: 'tish_test_bot', smsLogin: config.sms ?? true, passwordLogin: config.password ?? true,
      telegramCode: config.telegram ?? true,
    })),
    http.post('*/web/login/phone/code', async ({ request }) => {
      const body = await record('code', request)
      return config.sms === false && body.channel === 'sms'
        ? HttpResponse.json({ detail: 'Вход по SMS пока не подключён' }, { status: 503 }) : new HttpResponse(null, { status: 204 })
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
      if (body.password === 'много') return HttpResponse.json({ detail: 'Слишком много неверных попыток. Подождите 15 минут или нажмите «Забыли пароль?»' }, { status: 429 })
      return HttpResponse.json({ detail: WRONG }, { status: 401 })
    }),
    http.post('*/web/login/phone/password/new', async ({ request }) => {
      const body = await record('new', request)
      if (body.token !== 'tok-1') return HttpResponse.json({ detail: 'Подтверждение устарело — запросите код ещё раз' }, { status: 401 })
      session = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.history.replaceState(null, '', '/login')
  return posts
}

test('страница входа — сразу «номер + пароль», кнопки Telegram нет; номер и пароль только в теле запроса', async () => {
  const posts = backend()
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '0700 000 031')
  expect(screen.queryByRole('button', { name: 'Войти через Telegram' })).not.toBeInTheDocument()
  expect(screen.getByText(/Нет пароля\? Нажмите «Забыли пароль\? \/ Первый вход» — код придёт в Telegram/)).toBeInTheDocument()
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

test('«Забыли пароль? / Первый вход» → выбор «Код в Telegram» → код → «Придумайте пароль» → вход', async () => {
  const posts = backend()
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'не-тот-пароль')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(WRONG)

  await user.click(screen.getByRole('button', { name: 'Забыли пароль? / Первый вход' }))
  const form = screen.getByRole('form', { name: 'Код для входа' })
  expect(form).toHaveTextContent('если этот номер привязан к вашему Telegram')
  // Обе кнопки — всегда: сервер не говорит, привязан ли номер к Telegram
  expect(screen.getByRole('button', { name: 'Код по SMS' })).toBeInTheDocument()
  // Номер не набирать заново
  expect((screen.getByRole('textbox', { name: 'Номер телефона' }) as HTMLInputElement).value).toContain('700')
  await user.click(screen.getByRole('button', { name: 'Код в Telegram' }))

  const code = await screen.findByRole('textbox', { name: 'Код из Telegram' })
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  expect(screen.getByText(/через минуту выберите «Код по SMS»/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Отправить ещё раз через \d+ с/ })).toBeDisabled()
  await user.type(code, '000000')
  await user.click(screen.getByRole('button', { name: 'Дальше' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Код не подошёл')
  await user.clear(code)
  await user.type(code, '123456')
  await user.click(screen.getByRole('button', { name: 'Дальше' }))

  const fresh = await screen.findByRole('form', { name: 'Придумайте пароль' })
  expect(fresh).toHaveTextContent('Номер подтверждён')
  const field = screen.getByLabelText('Новый пароль')
  const repeat = screen.getByLabelText('Повторите пароль')
  expect(field).toHaveAttribute('autocomplete', 'new-password')
  const save = screen.getByRole('button', { name: 'Сохранить и войти' })
  // Правила пароля — до отправки
  await user.type(field, '12345678')
  await user.click(save)
  expect(screen.getByRole('alert')).toHaveTextContent('только из цифр')
  await user.clear(field)
  await user.type(field, '+996700000031')
  await user.click(save)
  expect(screen.getByRole('alert')).toHaveTextContent('не должен совпадать с номером')
  await user.clear(field)
  await user.type(field, 'Тишина2026')
  await user.type(repeat, 'Тишина2026')
  await user.click(save)

  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(posts.map((p) => p.path)).toEqual(['password', 'code', 'verify', 'verify', 'new'])
  expect(posts[1]!.body).toEqual({ phone: '+996 700000031', channel: 'telegram' })
  expect(posts.at(-1)!.body).toEqual({ token: 'tok-1', password: 'Тишина2026' })
})

test('«Код по SMS» — тот же путь, канал sms; «Другой номер или способ» возвращает к выбору', async () => {
  const posts = backend()
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Забыли пароль? / Первый вход' }))
  expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.click(screen.getByRole('button', { name: 'Код по SMS' }))
  expect(await screen.findByRole('textbox', { name: 'Код из SMS' })).toBeInTheDocument()
  expect(posts.at(-1)!.body).toEqual({ phone: '+996 700000031', channel: 'sms' })
  await user.click(screen.getByRole('button', { name: 'Другой номер или способ' }))
  expect(screen.getByRole('button', { name: 'Код в Telegram' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Назад: вход по паролю' }))
  expect(screen.getByLabelText('Пароль')).toBeInTheDocument()
})

test('429 — блок: текст сервера и заметная кнопка «Забыли пароль?»', async () => {
  backend()
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'много')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Подождите 15 минут')
  expect(screen.getByRole('button', { name: 'Забыли пароль? / Первый вход' })).toHaveClass('btn')
})

test('временный пароль от админа → сразу «Придумайте пароль»; пропуск устарел — заново к выбору кода', async () => {
  const posts = backend()
  server.use(http.post('*/web/login/phone/password/new', async ({ request }) => {
    posts.push({ path: 'new', body: await request.json() as Record<string, unknown>, header: null })
    return HttpResponse.json({ detail: 'Подтверждение устарело — запросите код ещё раз' }, { status: 401 })
  }))
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'Временный-1')
  await user.click(screen.getByRole('button', { name: 'Войти' }))

  expect(await screen.findByRole('form', { name: 'Придумайте пароль' })).toHaveTextContent('Временный пароль подошёл')
  await user.type(screen.getByLabelText('Новый пароль'), 'Мой-пароль-1')
  await user.type(screen.getByLabelText('Повторите пароль'), 'Мой-пароль-1')
  await user.click(screen.getByRole('button', { name: 'Сохранить и войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Подтверждение устарело')
  expect(screen.getByRole('form', { name: 'Код для входа' })).toBeInTheDocument()
})

test('SMS не подключены — только «Код в Telegram», без кнопки SMS', async () => {
  backend({ sms: false })
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Забыли пароль? / Первый вход' }))
  expect(screen.getByRole('button', { name: 'Код в Telegram' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Код по SMS' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Нет Telegram — выберите SMS/)).not.toBeInTheDocument()
})

test('ни Telegram-кодов, ни SMS — подсказка про временный пароль от админа', async () => {
  backend({ sms: false, telegram: false })
  renderApp()
  expect(await screen.findByLabelText('Пароль')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Забыли пароль/ })).not.toBeInTheDocument()
  expect(screen.getByText(/задать временный пароль/)).toBeInTheDocument()
  expect(screen.queryByText(/код придёт в Telegram/)).not.toBeInTheDocument()
})
