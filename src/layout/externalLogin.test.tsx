import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas, WebConfig } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import type { AppleIdentity, GoogleIdentity } from '../lib/providers'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { Login } from './Login'

const GOOGLE_CLIENT = 'test-client.apps.googleusercontent.com'
const APPLE_CLIENT = 'kg.tish.test'

type Call = { path: string; body: unknown; header: string | null }

/**
 * Страница входа с «Войти через Google / Apple» (ADR 0008 бэкенда). Скрипты провайдеров не грузим: подставные
 * window.google и window.AppleID; токены — вымышленные строки.
 */
function backend(config: Partial<WebConfig>, login: (provider: string) => Response | undefined = () => undefined) {
  let session = false
  const calls: Call[] = []
  let nonces = 0
  server.use(
    http.get('*/api/patient/me', () => (session ? HttpResponse.json(me) : HttpResponse.json({ detail: 'Войдите' }, { status: 401 }))),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', smsLogin: false, passwordLogin: true,
      telegramCode: true, telegramLogin: false, mailCode: false, ...config } satisfies WebConfig)),
    http.post('*/web/login/oauth/nonce', ({ request }) => {
      calls.push({ path: 'nonce', body: null, header: request.headers.get('X-Dental-Web') })
      nonces += 1
      return HttpResponse.json({ nonce: `nonce-${nonces}`, secondsLeft: 600 } satisfies Schemas['ExternalLoginControllerNonce'])
    }),
    http.post('*/web/login/oauth/:provider', async ({ request, params }) => {
      calls.push({ path: String(params.provider), body: await request.json(), header: request.headers.get('X-Dental-Web') })
      const custom = login(String(params.provider))
      if (custom) return custom
      session = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.history.replaceState(null, '', '/login')
  return calls
}

/** Подставной Google: renderButton рисует обычную кнопку, нажатие отдаёт credential в callback. */
function fakeGoogle(credential = 'google-id-token') {
  const inits: { client_id: string; nonce?: string }[] = []
  let callback: ((r: { credential?: string }) => void) | null = null
  const google: GoogleIdentity = {
    accounts: {
      id: {
        initialize: (config) => {
          inits.push({ client_id: config.client_id, nonce: config.nonce })
          callback = config.callback
        },
        renderButton: (parent) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = 'Войти с аккаунтом Google'
          button.onclick = () => callback?.({ credential })
          parent.appendChild(button)
        },
      },
    },
  }
  window.google = google
  return inits
}

function fakeApple(result: () => Promise<{ authorization?: { id_token?: string } }> = () => Promise.resolve({ authorization: { id_token: 'apple-id-token' } })) {
  const inits: { clientId: string; nonce?: string; usePopup?: boolean; redirectURI: string }[] = []
  const apple: AppleIdentity = {
    auth: {
      init: (config) => { inits.push(config) },
      signIn: result,
    },
  }
  window.AppleID = apple
  return inits
}

afterEach(() => {
  delete window.google
  delete window.AppleID
  delete window.Telegram
  localStorage.removeItem('crm.login.method')
})

test('провайдеры не подключены — кнопок Google и Apple нет, nonce не берём', async () => {
  const calls = backend({})
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  await screen.findByRole('textbox', { name: 'Номер телефона' })
  expect(screen.queryByRole('group', { name: 'Вход через Google или Apple' })).not.toBeInTheDocument()
  expect(calls).toEqual([])
})

test('«Войти через Google»: кнопка Google с nonce сервера → токен на сервер → вход в CRM', async () => {
  const calls = backend({ googleClientId: GOOGLE_CLIENT })
  const inits = fakeGoogle()
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Войти с аккаунтом Google' }))

  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(inits[0]).toEqual({ client_id: GOOGLE_CLIENT, nonce: 'nonce-1' })
  expect(calls.find((c) => c.path === 'google')).toEqual({ path: 'google', body: { idToken: 'google-id-token' }, header: '1' })
  expect(calls.find((c) => c.path === 'nonce')?.header).toBe('1')
  // Apple не подключён — его кнопки нет
  expect(screen.queryByRole('button', { name: 'Войти через Apple' })).not.toBeInTheDocument()
})

test('аккаунт не привязан — текст сервера, где привязать; новый nonce для следующей попытки', async () => {
  const text = 'Этот аккаунт Google не привязан. Войдите как обычно и привяжите его в «Я → Мой профиль».'
  backend({ googleClientId: GOOGLE_CLIENT },
    () => HttpResponse.json({ detail: text, code: 'identity-not-linked' }, { status: 401 }))
  const inits = fakeGoogle()
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Войти с аккаунтом Google' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(text)
  await waitFor(() => expect(inits.at(-1)?.nonce).toBe('nonce-2'))
  expect(screen.queryByRole('navigation', { name: 'Разделы' })).not.toBeInTheDocument()
})

test('«Войти через Apple»: окно Apple с nonce и всплывающим входом → id_token на сервер → вход', async () => {
  const calls = backend({ appleClientId: APPLE_CLIENT })
  const inits = fakeApple()
  const user = userEvent.setup()
  renderApp()

  const apple = await screen.findByRole('button', { name: 'Войти через Apple' })
  await waitFor(() => expect(apple).toBeEnabled())
  await user.click(apple)

  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(inits[0]).toMatchObject({ clientId: APPLE_CLIENT, nonce: 'nonce-1', usePopup: true, redirectURI: `${window.location.origin}/login` })
  expect(calls.find((c) => c.path === 'apple')?.body).toEqual({ idToken: 'apple-id-token' })
})

test('закрыли окно Apple — без ошибки и без запроса входа', async () => {
  const calls = backend({ appleClientId: APPLE_CLIENT })
  fakeApple(() => Promise.reject({ error: 'popup_closed_by_user' }))
  const user = userEvent.setup()
  renderApp()

  const apple = await screen.findByRole('button', { name: 'Войти через Apple' })
  await waitFor(() => expect(apple).toBeEnabled())
  await user.click(apple)

  await waitFor(() => expect(calls.filter((c) => c.path === 'nonce')).toHaveLength(2))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(calls.some((c) => c.path === 'apple')).toBe(false)
})

test('в Telegram (Mini App) кнопок Google и Apple нет', async () => {
  backend({ googleClientId: GOOGLE_CLIENT, appleClientId: APPLE_CLIENT })
  fakeGoogle()
  fakeApple()
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } } as unknown as typeof window.Telegram
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><Login /></QueryClientProvider>)

  expect(await screen.findByRole('textbox', { name: 'Номер телефона' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Вход через Google или Apple' })).not.toBeInTheDocument()
})
