import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { InviteInfo } from '../api/client'
import { renderApp } from '../test/fixtures'
import { server } from '../test/server'

/** Ссылка-приглашение на сайт: /invite#join_… — имена и номера вымышленные. */
const DOCTOR: InviteInfo = {
  kind: 'DOCTOR', clinicName: 'Стоматология «Тест»', fullName: 'Бакыт Тестов', roleText: 'врач',
  expiresAt: '2026-11-09T10:00:00Z', botUsername: 'tish_test_bot', codeRequired: false,
}

/** SMS на сервере подключены — номер подтверждается кодом. */
const WITH_CODE: InviteInfo = { ...DOCTOR, codeRequired: true }

type Sent = { path: string; body: Record<string, unknown>; header: string | null }

function backend(info: InviteInfo | null = DOCTOR) {
  const sent: Sent[] = []
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ detail: 'Войдите' }, { status: 401 })),
    http.post('*/web/invite', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sent.push({ path: 'view', body, header: request.headers.get('X-Dental-Web') })
      return info && body.token === 'join_abc123' ? HttpResponse.json(info)
        : HttpResponse.json({ detail: 'Ссылка-приглашение недействительна: истекла или по ней уже зарегистрировались. Попросите руководителя клиники прислать новую ссылку.' }, { status: 404 })
    }),
    http.post('*/web/invite/register', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sent.push({ path: 'register', body, header: request.headers.get('X-Dental-Web') })
      if (String(body.phone).includes('700 000 011')) {
        return HttpResponse.json({ detail: 'Этот номер уже зарегистрирован в Tish — войдите на сайте по номеру и паролю', code: 'phone-taken' }, { status: 409 })
      }
      if (body.password === 'Тишина-слабая') {
        return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'password', message: 'Пароль слишком простой' }] }, { status: 422 })
      }
      if (body.code !== undefined && body.code !== '123456') {
        return HttpResponse.json({ detail: 'Проверьте поля формы', errors: [{ field: 'code', message: 'Код не подошёл или устарел. Запросите новый' }] }, { status: 422 })
      }
      return HttpResponse.json({ fullName: 'Бакыт Тестов', roleText: 'врач' })
    }),
    http.post('*/web/invite/code', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      sent.push({ path: 'code', body, header: request.headers.get('X-Dental-Web') })
      if (String(body.phone).includes('700 000 011')) {
        return HttpResponse.json({ detail: 'Этот номер уже зарегистрирован в Tish — войдите на сайте по номеру и паролю', code: 'phone-taken' }, { status: 409 })
      }
      return HttpResponse.json({ phoneMasked: '+996 *** **56', secondsLeft: 300, resendSeconds: 60 })
    }),
    http.delete('*/web/invite/pending', () => {
      sent.push({ path: 'forget', body: {}, header: '1' })
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return sent
}

function open(hash: string) {
  window.history.replaceState(null, '', `/invite#${hash}`)
}

afterEach(() => window.history.replaceState(null, '', '/'))

test('приглашение: главное — «Открыть в Telegram», регистрация по номеру — по ссылке ниже', async () => {
  const sent = backend()
  open('join_abc123')
  const user = userEvent.setup()
  renderApp()

  expect(await screen.findByRole('heading', { name: 'Вас пригласили в Tish' })).toBeInTheDocument()
  expect(screen.getByText(/Клиника: Стоматология «Тест»/)).toHaveTextContent('Врач: Бакыт Тестов')
  expect(screen.getByRole('link', { name: 'Открыть в Telegram' })).toHaveAttribute('href', 'https://t.me/tish_test_bot?start=join_abc123')
  expect(screen.getByText('Нажмите «Начать» в боте — и вы в приложении.')).toBeInTheDocument()
  // Код — в теле POST с заголовком сайта, не в адресе запроса
  expect(sent[0]).toEqual({ path: 'view', body: { token: 'join_abc123' }, header: '1' })
  // Форма — только по нажатию на ссылку
  expect(screen.queryByRole('form', { name: 'Регистрация по номеру' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Нет Telegram? Зарегистрироваться по номеру телефона' }))
  const form = screen.getByRole('form', { name: 'Регистрация по номеру' })
  // SMS не подключены (codeRequired: false) — без шага кода: номер и пароль сразу
  expect(within(form).queryByRole('button', { name: 'Получить код' })).not.toBeInTheDocument()

  await user.type(within(form).getByRole('textbox', { name: 'Ваш номер телефона' }), '555 123 456')
  await user.type(within(form).getByLabelText('Придумайте пароль'), 'Улыбка2026')
  await user.type(within(form).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(form).getByRole('button', { name: 'Зарегистрироваться' }))

  expect(await screen.findByRole('heading', { name: 'Добро пожаловать, Бакыт Тестов!' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Открыть Tish' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('link', { name: 'tish.kg/app' })).toHaveAttribute('href', '/app')
  expect(sent[1]).toEqual({ path: 'register', body: { token: 'join_abc123', phone: '+996 555 123 456', password: 'Улыбка2026' }, header: '1' })
  // Номер и пароль — не в адресе и не в localStorage
  expect(window.location.href).not.toContain('555')
  expect(JSON.stringify({ ...localStorage })).not.toContain('Улыбка2026')
})

test('приглашение: номер занят (409) и слабый пароль (422) — под полями, можно исправить', async () => {
  backend()
  open('join_abc123')
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Зарегистрироваться по номеру телефона' }))
  const form = screen.getByRole('form', { name: 'Регистрация по номеру' })
  const phone = within(form).getByRole('textbox', { name: 'Ваш номер телефона' })
  await user.type(phone, '700 000 011')
  await user.type(within(form).getByLabelText('Придумайте пароль'), 'Улыбка2026')
  await user.type(within(form).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(form).getByRole('button', { name: 'Зарегистрироваться' }))
  expect(await within(form).findByText('Этот номер уже зарегистрирован в Tish — войдите на сайте по номеру и паролю')).toBeInTheDocument()

  // Пароли не совпали — проверка до отправки
  await user.clear(phone)
  await user.type(phone, '555 123 456')
  await user.clear(within(form).getByLabelText('Повторите пароль'))
  await user.type(within(form).getByLabelText('Повторите пароль'), 'Другой2026')
  await user.click(within(form).getByRole('button', { name: 'Зарегистрироваться' }))
  expect(within(form).getByText('Пароли не совпадают')).toBeInTheDocument()

  // Ответ сервера 422 — под паролем
  await user.clear(within(form).getByLabelText('Придумайте пароль'))
  await user.type(within(form).getByLabelText('Придумайте пароль'), 'Тишина-слабая')
  await user.clear(within(form).getByLabelText('Повторите пароль'))
  await user.type(within(form).getByLabelText('Повторите пароль'), 'Тишина-слабая')
  await user.click(within(form).getByRole('button', { name: 'Зарегистрироваться' }))
  expect(await within(form).findByText('Пароль слишком простой')).toBeInTheDocument()
})

test('приглашение: недействительная или испорченная ссылка — попросить новую', async () => {
  backend(null)
  open('join_abc123')
  const { unmount } = renderApp()
  expect(await screen.findByRole('heading', { name: 'Ссылка не работает' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Попросите руководителя клиники прислать новую ссылку')
  expect(screen.queryByRole('link', { name: 'Открыть в Telegram' })).not.toBeInTheDocument()
  unmount()

  open('что-то-не-то')
  renderApp()
  expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка неполная или с ошибкой. Попросите руководителя клиники прислать новую ссылку.')
})

test('приглашение с SMS: номер → «Получить код» → код и пароль → вход; номер — не в адресе и не в localStorage', async () => {
  const sent = backend(WITH_CODE)
  open('join_abc123')
  const user = userEvent.setup()
  renderApp()
  await user.click(await screen.findByRole('button', { name: 'Нет Telegram? Зарегистрироваться по номеру телефона' }))
  const form = screen.getByRole('form', { name: 'Регистрация по номеру' })
  // На первом шаге — только номер
  expect(within(form).queryByLabelText('Придумайте пароль')).not.toBeInTheDocument()

  // Номер занят — сервер скажет до SMS, шаг кода не открывается
  const phone = within(form).getByRole('textbox', { name: 'Ваш номер телефона' })
  await user.type(phone, '700 000 011')
  await user.click(within(form).getByRole('button', { name: 'Получить код' }))
  expect(await within(form).findByText('Этот номер уже зарегистрирован в Tish — войдите на сайте по номеру и паролю')).toBeInTheDocument()

  await user.clear(phone)
  await user.type(phone, '555 123 456')
  await user.click(within(form).getByRole('button', { name: 'Получить код' }))
  const step = await screen.findByRole('form', { name: 'Код из SMS' })
  expect(within(step).getByRole('status')).toHaveTextContent('Отправили SMS с кодом на +996 *** **56. Код действует 5 мин.')
  expect(sent.find((x) => x.path === 'code' && x.body.phone === '+996 555 123 456')).toBeTruthy()
  // «Отправить ещё раз» — только через минуту
  expect(within(step).getByText('Отправить ещё раз — через 60 с.')).toBeInTheDocument()

  // Неверный код — под полем кода
  await user.type(within(step).getByLabelText('Код подтверждения'), '000000')
  await user.type(within(step).getByLabelText('Придумайте пароль'), 'Улыбка2026')
  await user.type(within(step).getByLabelText('Повторите пароль'), 'Улыбка2026')
  await user.click(within(step).getByRole('button', { name: 'Зарегистрироваться' }))
  expect(await within(step).findByText('Код не подошёл или устарел. Запросите новый')).toBeInTheDocument()

  await user.clear(within(step).getByLabelText('Код подтверждения'))
  await user.type(within(step).getByLabelText('Код подтверждения'), '123456')
  await user.click(within(step).getByRole('button', { name: 'Зарегистрироваться' }))
  expect(await screen.findByRole('heading', { name: 'Добро пожаловать, Бакыт Тестов!' })).toBeInTheDocument()
  // Номер в регистрации не шлём — сервер знает его сам (код пришёл на него)
  expect(sent.filter((x) => x.path === 'register').at(-1)).toEqual({
    path: 'register', body: { token: 'join_abc123', code: '123456', password: 'Улыбка2026' }, header: '1',
  })
  expect(window.location.href).not.toContain('555')
  expect(JSON.stringify({ ...localStorage })).not.toContain('555')
})

test('приглашение с SMS: перезагрузка на шаге кода — сразу шаг кода, «Отправить ещё раз» без номера', async () => {
  const sent = backend({ ...WITH_CODE, pending: { phoneMasked: '+996 *** **56', secondsLeft: 170, resendSeconds: 0 } })
  open('join_abc123')
  const user = userEvent.setup()
  renderApp()

  const step = await screen.findByRole('form', { name: 'Код из SMS' })
  expect(within(step).getByRole('status')).toHaveTextContent('Отправили SMS с кодом на +996 *** **56. Код действует 3 мин.')
  expect(screen.queryByRole('form', { name: 'Регистрация по номеру' })).not.toBeInTheDocument()

  await user.click(within(step).getByRole('button', { name: 'Отправить код ещё раз' }))
  // Набранного номера после перезагрузки нет — только код ссылки, номер сервер возьмёт из своей cookie
  expect(sent.find((x) => x.path === 'code')).toEqual({ path: 'code', body: { token: 'join_abc123' }, header: '1' })
  expect(await within(step).findByText('Отправить ещё раз — через 60 с.')).toBeInTheDocument()

  // «Другой номер» — сервер забывает шаг, снова ввод номера
  await user.click(within(step).getByRole('button', { name: 'Другой номер' }))
  expect(await screen.findByRole('form', { name: 'Регистрация по номеру' })).toBeInTheDocument()
  expect(sent.some((x) => x.path === 'forget')).toBe(true)
})
