import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

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
  expect(screen.getByText(/Нет пароля или забыли\? Нажмите «Забыли пароль\? \/ Первый вход» — код придёт по SMS/)).toBeInTheDocument()
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

test('«Забыли пароль? / Первый вход» → одна кнопка «Получить код» → код → «Подтвердить» → только потом пароль → вход', async () => {
  const posts = backend()
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Номер телефона' }), '700000031')
  await user.type(screen.getByLabelText('Пароль'), 'не-тот-пароль')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(WRONG)

  await user.click(screen.getByRole('button', { name: 'Забыли пароль? / Первый вход' }))
  const form = screen.getByRole('form', { name: 'Код для входа' })
  expect(form).toHaveTextContent('если номер привязан к вашему Telegram')
  // Кнопка одна: канал выбирает сервер
  expect(screen.queryByRole('button', { name: 'Код в Telegram' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Код по SMS' })).not.toBeInTheDocument()
  // Номер не набирать заново
  expect((screen.getByRole('textbox', { name: 'Номер телефона' }) as HTMLInputElement).value).toContain('700')
  await user.click(screen.getByRole('button', { name: 'Получить код' }))

  const step = await screen.findByRole('form', { name: 'Код подтверждения' })
  expect(step).toHaveTextContent('Отправили код: в Telegram (от бота клиники), если номер привязан к вашему Telegram, иначе — SMS на этот номер.')
  // Пароля на этом шаге нет — только после «Подтвердить»
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  // «Отправить по SMS» — не сразу, а через минуту
  expect(screen.queryByRole('button', { name: 'Не пришло? Отправить по SMS' })).not.toBeInTheDocument()
  expect(step).toHaveTextContent(/Через \d+ с можно отправить по SMS/)
  const code = screen.getByRole('textbox', { name: 'Код подтверждения' })
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  await user.type(code, '000000')
  await user.click(screen.getByRole('button', { name: 'Подтвердить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Код не подошёл')
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  await user.clear(code)
  await user.type(code, '123456')
  await user.click(screen.getByRole('button', { name: 'Подтвердить' }))

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
  // Канал не выбираем — сервер решает сам
  expect(posts[1]!.body).toEqual({ phone: '+996 700000031' })
  expect(posts.at(-1)!.body).toEqual({ token: 'tok-1', password: 'Тишина2026' })
})

test('«Не пришло? Отправить по SMS» появляется через 60 секунд и явно просит SMS', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const posts = backend()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Забыли пароль? / Первый вход' }))
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
    await user.click(screen.getByRole('button', { name: 'Получить код' }))
    await screen.findByRole('form', { name: 'Код подтверждения' })

    for (let i = 0; i < 59; i++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('button', { name: 'Не пришло? Отправить по SMS' })).not.toBeInTheDocument()
    expect(screen.getByText('Не пришло? Через 1 с можно отправить по SMS.')).toBeInTheDocument()
    expect(screen.queryByText(/Не приходит код\? Если вы работаете в Tish через Telegram/)).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1000) })
    // Через минуту — подсказка про частую причину: номер для входа не привязан к Telegram
    expect(screen.getByText(/Не приходит код\? Если вы работаете в Tish через Telegram/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Не пришло? Отправить по SMS' }))

    expect(await screen.findByText(/Отправили SMS с кодом на этот номер/)).toBeInTheDocument()
    expect(posts.at(-1)!.body).toEqual({ phone: '+996 700000031', channel: 'sms' })
    // Снова минута до следующей отправки
    expect(screen.queryByRole('button', { name: 'Не пришло? Отправить по SMS' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Другой номер' }))
    expect(screen.getByRole('button', { name: 'Получить код' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Назад: вход по паролю' }))
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
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

test('временный пароль от админа → сразу «Придумайте пароль»; пропуск устарел — заново к «Получить код»', async () => {
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

test('SMS не подключены — «Получить код» (Telegram), без SMS в тексте и без «Отправить по SMS»', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    backend({ sms: false })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Забыли пароль? / Первый вход' }))
    await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '700000031')
    await user.click(screen.getByRole('button', { name: 'Получить код' }))
    const step = await screen.findByRole('form', { name: 'Код подтверждения' })
    expect(step).toHaveTextContent('Отправили код в Telegram (от бота клиники), если номер привязан к вашему Telegram.')
    for (let i = 0; i < 60; i++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('button', { name: 'Не пришло? Отправить по SMS' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить код ещё раз' })).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('ни Telegram-кодов, ни SMS — подсказка про временный пароль от админа', async () => {
  backend({ sms: false, telegram: false })
  renderApp()
  expect(await screen.findByLabelText('Пароль')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Забыли пароль/ })).not.toBeInTheDocument()
  expect(screen.getByText(/задать временный пароль/)).toBeInTheDocument()
  expect(screen.queryByText(/код придёт в Telegram/)).not.toBeInTheDocument()
})

/** Сервер помнит незаконченный вход (HttpOnly-cookie) — страницу перезагрузили, пока человек был в Telegram. */
function pendingStep(step: 'code' | 'password', extra: { temporary?: boolean } = {}) {
  const forgotten: string[] = []
  server.use(
    http.get('*/web/login/phone/pending', ({ request }) => {
      expect(request.headers.get('X-Dental-Web')).toBe('1')
      return forgotten.length ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json({ step, phoneMasked: '+996 *** **31', secondsLeft: 200, resendSeconds: 0, temporary: extra.temporary ?? false })
    }),
    http.delete('*/web/login/phone/pending', ({ request }) => {
      forgotten.push(request.headers.get('X-Dental-Web') ?? '')
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return forgotten
}

test('перезагрузили на шаге кода — сразу «Код подтверждения» с маской номера; код и пароль уходят без номера', async () => {
  const posts = backend()
  pendingStep('code')
  const user = userEvent.setup()
  renderApp()

  const step = await screen.findByRole('form', { name: 'Код подтверждения' })
  expect(step).toHaveTextContent('Код отправлен на +996 *** **31.')
  expect(step).toHaveTextContent('Код действует ещё 4 мин.')
  // Отсчёт повторной отправки — по словам сервера: уже можно
  expect(screen.getByRole('button', { name: 'Не пришло? Отправить по SMS' })).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.click(screen.getByRole('button', { name: 'Подтвердить' }))

  expect(await screen.findByRole('form', { name: 'Придумайте пароль' })).toHaveTextContent('Номер +996 *** **31 подтверждён')
  await user.type(screen.getByLabelText('Новый пароль'), 'Тишина2026')
  await user.type(screen.getByLabelText('Повторите пароль'), 'Тишина2026')
  await user.click(screen.getByRole('button', { name: 'Сохранить и войти' }))
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(posts.map((p) => p.body)).toEqual([{ code: '123456' }, { token: 'tok-1', password: 'Тишина2026' }])
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('31')
})

test('повторная отправка после перезагрузки — без номера: сервер возьмёт свой', async () => {
  const posts = backend()
  pendingStep('code')
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Не пришло? Отправить по SMS' }))
  expect(await screen.findByText(/Отправили SMS с кодом на этот номер/)).toBeInTheDocument()
  expect(posts).toEqual([{ path: 'code', body: { channel: 'sms' }, header: '1' }])
})

test('перезагрузили на шаге пароля — сразу «Придумайте пароль»; пропуск уходит из cookie, не из страницы', async () => {
  const posts = backend()
  server.use(http.post('*/web/login/phone/password/new', async ({ request }) => {
    posts.push({ path: 'new', body: await request.json() as Record<string, unknown>, header: request.headers.get('X-Dental-Web') })
    return new HttpResponse(null, { status: 204 })
  }))
  pendingStep('password')
  const user = userEvent.setup()
  renderApp()
  expect(await screen.findByRole('form', { name: 'Придумайте пароль' })).toHaveTextContent('Номер +996 *** **31 подтверждён')
  await user.type(screen.getByLabelText('Новый пароль'), 'Тишина2026')
  await user.type(screen.getByLabelText('Повторите пароль'), 'Тишина2026')
  await user.click(screen.getByRole('button', { name: 'Сохранить и войти' }))
  await waitForSlow(() => expect(posts).toEqual([{ path: 'new', body: { password: 'Тишина2026' }, header: '1' }]))
})

test('«Другой номер» после перезагрузки гасит незаконченный вход на сервере', async () => {
  backend()
  const forgotten = pendingStep('code')
  const user = userEvent.setup()
  renderApp()
  await screen.findByRole('form', { name: 'Код подтверждения' })
  await user.click(screen.getByRole('button', { name: 'Другой номер' }))
  expect(screen.getByRole('form', { name: 'Код для входа' })).toBeInTheDocument()
  expect((screen.getByRole('textbox', { name: 'Номер телефона' }) as HTMLInputElement).value).toBe('')
  await waitForSlow(() => expect(forgotten).toEqual(['1']))
})

test('время на код вышло после перезагрузки — понятная ошибка и снова номер', async () => {
  backend()
  pendingStep('code')
  server.use(http.post('*/web/login/phone', () => HttpResponse.json(
    { detail: 'Время на ввод кода вышло — введите номер и запросите код ещё раз' }, { status: 401 })))
  const user = userEvent.setup()
  renderApp()
  await user.type(await screen.findByRole('textbox', { name: 'Код подтверждения' }), '123456')
  await user.click(screen.getByRole('button', { name: 'Подтвердить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Время на ввод кода вышло')
  expect(screen.getByRole('form', { name: 'Код для входа' })).toBeInTheDocument()
})

test('«Вставить код» — по нажатию берёт 6 цифр из буфера (скопировали в Telegram)', async () => {
  backend()
  pendingStep('code')
  const user = userEvent.setup()
  renderApp()
  const field = await screen.findByRole('textbox', { name: 'Код подтверждения' })
  await navigator.clipboard.writeText('Код: 654 321')
  await user.click(screen.getByRole('button', { name: 'Вставить код' }))
  // Буфер читается асинхронно: в полном параллельном прогоне значение появляется не сразу после нажатия
  await waitFor(() => expect(field).toHaveValue('654321'))
  await navigator.clipboard.writeText('привет')
  await user.click(screen.getByRole('button', { name: 'Вставить код' }))
  expect(await screen.findByText(/В буфере нет кода из 6 цифр/)).toBeInTheDocument()
  expect(field).toHaveValue('654321')
})
