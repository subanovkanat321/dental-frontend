import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas, WebConfig } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import type { GoogleIdentity } from '../lib/providers'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { Login } from './Login'

const GOOGLE_CLIENT = 'test-client.apps.googleusercontent.com'

type Call = { path: string; body: unknown; header: string | null }

/**
 * Страница входа с «Войти через Google» (ADR 0008 бэкенда; «Войти через Apple» убран). Скрипт Google не грузим:
 * подставной window.google; токены — вымышленные строки.
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

afterEach(() => {
  delete window.google
  delete window.Telegram
})

test('Google не подключён — кнопки нет, nonce не берём', async () => {
  const calls = backend({})
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Вход для клиники' })).toBeInTheDocument()
  await screen.findByRole('textbox', { name: 'Логин или телефон' })
  expect(screen.queryByRole('group', { name: 'Вход через Google' })).not.toBeInTheDocument()
  // Других способов нет — нет и ссылки
  expect(screen.queryByRole('button', { name: 'Другие способы входа' })).not.toBeInTheDocument()
  expect(calls).toEqual([])
})

test('«Войти через Google»: кнопка Google с nonce сервера → токен на сервер → вход в CRM', async () => {
  const calls = backend({ googleClientId: GOOGLE_CLIENT })
  const inits = fakeGoogle()
  const user = userEvent.setup()
  renderApp()

  // Google — второстепенный: под свёрнутой ссылкой «Другие способы входа»; скрипт и nonce — только после неё
  await screen.findByRole('textbox', { name: 'Логин или телефон' })
  expect(screen.queryByRole('button', { name: 'Войти с аккаунтом Google' })).not.toBeInTheDocument()
  expect(calls).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Другие способы входа' }))
  await user.click(await screen.findByRole('button', { name: 'Войти с аккаунтом Google' }))

  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(inits[0]).toEqual({ client_id: GOOGLE_CLIENT, nonce: 'nonce-1' })
  expect(calls.find((c) => c.path === 'google')).toEqual({ path: 'google', body: { idToken: 'google-id-token' }, header: '1' })
  expect(calls.find((c) => c.path === 'nonce')?.header).toBe('1')
  // «Войти через Apple» убран совсем
  expect(screen.queryByRole('button', { name: /Apple/ })).not.toBeInTheDocument()
})

test('аккаунт не привязан — текст сервера, где привязать; новый nonce для следующей попытки', async () => {
  const text = 'Этот аккаунт Google не привязан. Войдите как обычно и привяжите его в «Я → Мой профиль».'
  backend({ googleClientId: GOOGLE_CLIENT },
    () => HttpResponse.json({ detail: text, code: 'identity-not-linked' }, { status: 401 }))
  const inits = fakeGoogle()
  const user = userEvent.setup()
  renderApp()

  await user.click(await screen.findByRole('button', { name: 'Другие способы входа' }))
  await user.click(await screen.findByRole('button', { name: 'Войти с аккаунтом Google' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(text)
  await waitFor(() => expect(inits.at(-1)?.nonce).toBe('nonce-2'))
  expect(screen.queryByRole('navigation', { name: 'Разделы' })).not.toBeInTheDocument()
})

test('в Telegram (Mini App) кнопки Google нет', async () => {
  backend({ googleClientId: GOOGLE_CLIENT })
  fakeGoogle()
  window.Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } } as unknown as typeof window.Telegram
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><Login /></QueryClientProvider>)

  expect(await screen.findByRole('textbox', { name: 'Логин или телефон' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Вход через Google' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Другие способы входа' })).not.toBeInTheDocument()
})
