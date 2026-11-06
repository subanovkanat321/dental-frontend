import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { LOGGED_OUT } from '../api/client'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Call = { path: string; header: string | null }

/** Сотрудник на сайте (cookie-сессия) или в Telegram; запоминаем выходы, ушедшие на сервер. */
function backend(session = true) {
  const calls: Call[] = []
  server.use(
    http.get('*/api/patient/me', () => (session ? HttpResponse.json(me) : HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))),
    http.get('*/api/me/password', () => HttpResponse.json({ phoneLogin: false, passwordSet: false, temporary: false, sms: false, telegram: true })),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', botId: 123456, smsLogin: false, passwordLogin: true })),
    http.post('*/web/logout', ({ request }) => {
      calls.push({ path: 'logout', header: request.headers.get('X-Dental-Web') })
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/api/me/logout-all', ({ request }) => {
      calls.push({ path: 'logout-all', header: request.headers.get('X-Dental-Web') })
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  return calls
}

function stubReload() {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  return reload
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  window.Telegram = undefined
})

test('«Выйти»: сервер гасит сессию, после перезагрузки — подсказка про общий компьютер', async () => {
  const calls = backend()
  window.location.hash = '/settings'
  const reload = stubReload()
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Выйти' }))

  await vi.waitFor(() => expect(reload).toHaveBeenCalled())
  expect(calls).toEqual([{ path: 'logout', header: '1' }])
  expect(sessionStorage.getItem(LOGGED_OUT)).toBe('1')
})

test('Экран входа после выхода: подсказка один раз, без личных данных в адресе', async () => {
  backend(false)
  sessionStorage.setItem(LOGGED_OUT, '1')
  window.Telegram = { Login: { auth: vi.fn() } }
  window.history.replaceState(null, '', '/login')
  const user = userEvent.setup()
  const { unmount } = renderApp()

  const hint = await screen.findByRole('status')
  expect(hint).toHaveTextContent('Вы вышли из Tish')
  expect(hint).toHaveTextContent('Настройки → Устройства → Вход на сайты')
  expect(hint).toHaveTextContent('tish.kg')
  expect(hint).toHaveTextContent('по номеру и паролю или в режиме инкогнито')
  expect(window.location.search).toBe('')
  // Флаг стёрт сразу: обновили страницу — подсказки нет
  expect(sessionStorage.getItem(LOGGED_OUT)).toBeNull()
  await user.click(within(hint).getByRole('button', { name: 'Понятно' }))
  expect(screen.queryByText(/Вы вышли из Tish/)).not.toBeInTheDocument()
  unmount()

  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  expect(screen.queryByText(/Вы вышли из Tish/)).not.toBeInTheDocument()
})

test('Обычный экран входа (не после выхода) — без подсказки', async () => {
  backend(false)
  window.Telegram = { Login: { auth: vi.fn() } }
  window.history.replaceState(null, '', '/login')
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  expect(screen.queryByText(/Вы вышли из Tish/)).not.toBeInTheDocument()
})

test('«Выйти на всех устройствах» — только после подтверждения; затем экран входа с подсказкой', async () => {
  const calls = backend()
  window.history.replaceState(null, '', '/')
  window.location.hash = '/settings'
  const reload = stubReload()
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Выйти на всех устройствах' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Закроются все входы на сайт Tish')
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(calls).toEqual([])

  await user.click(screen.getByRole('button', { name: 'Выйти на всех устройствах' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Выйти' }))

  await vi.waitFor(() => expect(reload).toHaveBeenCalled())
  expect(calls).toEqual([{ path: 'logout-all', header: '1' }])
  expect(sessionStorage.getItem(LOGGED_OUT)).toBe('1')
})

test('В Telegram: «Выйти» нет, «Выйти на всех устройствах» закрывает входы на сайт без перезагрузки', async () => {
  const calls = backend()
  window.Telegram = { WebApp: { initData: 'signed', ready() {}, expand() {} } } as unknown as typeof window.Telegram
  window.location.hash = '/settings'
  const reload = stubReload()
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Выйти на всех устройствах' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('в Telegram, Tish останется открытым')
  await user.click(within(dialog).getByRole('button', { name: 'Выйти' }))

  expect(await screen.findByText('Готово: все входы на сайт Tish закрыты.')).toBeInTheDocument()
  expect(calls).toEqual([{ path: 'logout-all', header: '1' }])
  expect(reload).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Выйти' })).not.toBeInTheDocument()
})
