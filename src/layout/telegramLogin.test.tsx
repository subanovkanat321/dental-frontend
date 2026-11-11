import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { TelegramLoginStatus } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { Login } from './Login'

const LINK = 'https://t.me/tish_test_bot?start=weblogin_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

type Call = { method: string; path: string; header: string | null }

/**
 * Фальшивый бэкенд «Войти через Telegram»: statuses — что по очереди отвечает status (последний повторяется);
 * done — вошли, теперь /api/patient/me отдаёт сотрудника.
 */
function backend(statuses: TelegramLoginStatus['state'][], { telegramLogin = true } = {}) {
  let session = false
  let i = 0
  const calls: Call[] = []
  server.use(
    http.get('*/api/patient/me', () => (session ? HttpResponse.json(me) : HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))),
    http.get('*/web/config', () => HttpResponse.json({
      botUsername: 'tish_test_bot', smsLogin: false, passwordLogin: true, telegramCode: true, telegramLogin,
    })),
    http.post('*/web/login/telegram/start', ({ request }) => {
      calls.push({ method: 'POST', path: 'start', header: request.headers.get('X-Dental-Web') })
      return HttpResponse.json({ link: LINK, secondsLeft: 300 })
    }),
    http.get('*/web/login/telegram/status', ({ request }) => {
      calls.push({ method: 'GET', path: 'status', header: request.headers.get('X-Dental-Web') })
      const state = statuses[Math.min(i++, statuses.length - 1)]!
      if (state === 'done') session = true
      const body: TelegramLoginStatus = { state, secondsLeft: state === 'waiting' ? 280 : 0, link: state === 'waiting' ? LINK : null }
      return HttpResponse.json(body)
    }),
    http.delete('*/web/login/telegram', ({ request }) => {
      calls.push({ method: 'DELETE', path: 'forget', header: request.headers.get('X-Dental-Web') })
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.history.replaceState(null, '', '/login')
  return calls
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.Telegram
})

test('«Войти через Telegram» → открывает бота, ждёт «Подтвердить вход», опрос раз в 2 секунды → вход в CRM', async () => {
  const calls = backend(['none', 'waiting', 'done'])
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const user = userEvent.setup()
  renderApp()
  // Кнопка Telegram — первой, под ней «Нет Telegram?» и форма номера и пароля
  const phone = await screen.findByRole('textbox', { name: 'Номер телефона' })
  expect(screen.getByText(/через Telegram в одно нажатие или по номеру телефона и паролю/)).toBeInTheDocument()
  const tg = await screen.findByRole('button', { name: 'Войти через Telegram' })
  expect(tg.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('Нет Telegram? Войдите по номеру и паролю')).toBeInTheDocument()

  await user.click(await screen.findByRole('button', { name: 'Войти через Telegram' }))

  expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener')
  const waiting = await screen.findByRole('status', { name: 'Ждём подтверждения в Telegram' })
  expect(waiting).toHaveTextContent('Откройте Telegram и нажмите «Подтвердить вход».')
  // Не открылось окно — та же ссылка кнопкой
  expect(screen.getByRole('link', { name: 'Открыть Telegram' })).toHaveAttribute('href', LINK)
  // Пока ждём — формы номера нет, чтобы не путать
  expect(screen.queryByRole('textbox', { name: 'Номер телефона' })).not.toBeInTheDocument()

  // Опрос: «waiting» → «done» → CRM
  expect(await screen.findByRole('navigation', { name: 'Разделы' }, { timeout: 8000 })).toBeInTheDocument()
  expect(window.location.pathname).toBe('/')
  expect(calls.filter((c) => c.path === 'status').length).toBeGreaterThanOrEqual(3)
  expect(calls.every((c) => c.header === '1')).toBe(true)
}, 15000)

test('ожидание переживает перезагрузку: экран входа сразу спрашивает status и снова показывает ожидание', async () => {
  backend(['waiting'])
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  renderApp()

  expect(await screen.findByRole('status', { name: 'Ждём подтверждения в Telegram' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Открыть Telegram' })).toHaveAttribute('href', LINK)
  // Само не открывает Telegram ещё раз — только по нажатию
  expect(open).not.toHaveBeenCalled()
})

test('«Отмена» на сайте забывает вход; «Нет» в боте — понятный текст', async () => {
  const calls = backend(['waiting'])
  const user = userEvent.setup()
  const view = renderApp()

  await user.click(await screen.findByRole('button', { name: 'Отмена' }))
  expect(await screen.findByRole('button', { name: 'Войти через Telegram' })).toBeInTheDocument()
  expect(calls.some((c) => c.path === 'forget')).toBe(true)
  view.unmount()

  backend(['waiting', 'cancelled'])
  renderApp()
  expect(await screen.findByText('Вход отменён в Telegram.', undefined, { timeout: 5000 })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Войти через Telegram' })).toBeInTheDocument()
  expect(await screen.findByRole('textbox', { name: 'Номер телефона' })).toBeInTheDocument()
}, 10000)

test('вход через Telegram не включён на сервере — кнопки нет', async () => {
  backend(['none'], { telegramLogin: false })
  renderApp()
  expect(await screen.findByRole('textbox', { name: 'Номер телефона' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Войти через Telegram' })).not.toBeInTheDocument()
})

test('внутри Telegram (Mini App) кнопки «Войти через Telegram» нет — там вход и так через Telegram', async () => {
  backend(['none'])
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } } as unknown as typeof window.Telegram
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><Login /></QueryClientProvider>)

  expect(await screen.findByRole('textbox', { name: 'Номер телефона' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Войти через Telegram' })).not.toBeInTheDocument()
  expect(screen.queryByText(/через Telegram/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Нет Telegram\?/)).not.toBeInTheDocument()
})
