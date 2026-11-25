import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas, WebConfig } from '../api/client'
import type { GoogleIdentity } from '../lib/providers'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'

type Identity = Schemas['ExternalLoginControllerIdentityView']

const GOOGLE_CLIENT = 'test-client.apps.googleusercontent.com'

/** «Мой профиль → Вход через Google и Apple» (ADR 0008 бэкенда); аккаунты и почта — вымышленные. */
function backend(initial: Identity[], link?: () => Response) {
  let state = initial
  const linked: unknown[] = []
  let unlinked = 0
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json({ ...me, doctorId: undefined, admin: false, reception: true })),
    http.get('*/api/me/phone', () => HttpResponse.json({ phone: '+996700000051', phoneOnly: false, sms: true, telegram: true } satisfies Schemas['MyPhoneControllerMyPhone'])),
    http.get('*/api/me/email', () => HttpResponse.json({ phoneLogin: true, available: false } satisfies Schemas['MyEmailControllerMyEmail'])),
    http.get('*/web/config', () => HttpResponse.json({ botUsername: 'tish_test_bot', smsLogin: false, passwordLogin: true, telegramCode: true,
      telegramLogin: true, mailCode: false, googleClientId: GOOGLE_CLIENT, appleClientId: 'kg.tish.test' } satisfies WebConfig)),
    http.post('*/web/login/oauth/nonce', () => HttpResponse.json({ nonce: 'nonce-1', secondsLeft: 600 } satisfies Schemas['ExternalLoginControllerNonce'])),
    http.get('*/api/me/identities', () => HttpResponse.json(state)),
    http.post('*/api/me/identities/:provider', async ({ request, params }) => {
      linked.push({ provider: params.provider, body: await request.json(), header: request.headers.get('X-Dental-Web') })
      if (link) return link()
      state = state.map((i) => (i.provider === params.provider ? { ...i, linked: true, email: 'vrach.test@example.com', linkedAt: '2026-11-25T10:00:00Z' } : i))
      return HttpResponse.json(state)
    }),
    http.delete('*/api/me/identities/:provider', ({ params }) => {
      unlinked++
      state = state.map((i) => (i.provider === params.provider ? { provider: i.provider, available: i.available, linked: false } : i))
      return HttpResponse.json(state)
    }),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  window.location.hash = '/settings/profile'
  return { linked, unlinked: () => unlinked }
}

function fakeGoogle() {
  let callback: ((r: { credential?: string }) => void) | null = null
  const google: GoogleIdentity = {
    accounts: {
      id: {
        initialize: (config) => { callback = config.callback },
        renderButton: (parent) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = 'Продолжить с Google'
          button.onclick = () => callback?.({ credential: 'google-id-token' })
          parent.appendChild(button)
        },
      },
    },
  }
  window.google = google
}

const NOT_LINKED: Identity[] = [{ provider: 'google', available: true, linked: false }, { provider: 'apple', available: true, linked: false }]

afterEach(() => {
  window.location.hash = ''
  delete window.google
  delete window.Telegram
})

test('провайдеры не подключены — блока «Вход через Google и Apple» нет', async () => {
  backend([])
  renderApp()
  expect(await screen.findByRole('region', { name: 'Телефон' })).toBeInTheDocument()
  await screen.findByText('+996 700 000 051')
  expect(screen.queryByRole('region', { name: 'Вход через Google и Apple' })).not.toBeInTheDocument()
})

test('«Привязать Google» → окно Google → привязан, видна почта; «Отвязать» — с вопросом', async () => {
  const { linked, unlinked } = backend(NOT_LINKED)
  fakeGoogle()
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Вход через Google и Apple' })
  expect(within(section).getAllByText('Не привязан')).toHaveLength(2)
  expect(within(section).getByRole('button', { name: 'Привязать Apple' })).toBeInTheDocument()

  await user.click(within(section).getByRole('button', { name: 'Привязать Google' }))
  await user.click(await within(section).findByRole('button', { name: 'Продолжить с Google' }))

  expect(await screen.findByText(/Google привязан\. Теперь на странице входа можно нажать «Войти через Google»/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Понятно' }))
  expect(await within(section).findByText(/Привязан: vrach\.test@example\.com/)).toBeInTheDocument()
  expect(linked).toEqual([{ provider: 'google', body: { idToken: 'google-id-token' }, header: '1' }])

  await user.click(within(section).getByRole('button', { name: 'Отвязать' }))
  expect(await screen.findByText(/Отвязать Google\? Входы через него на всех устройствах закроются/)).toBeInTheDocument()
  await user.click(within(screen.getByRole('alertdialog', { name: 'Подтверждение' })).getByRole('button', { name: 'Отвязать' }))
  await waitFor(() => expect(unlinked()).toBe(1))
  expect(await within(section).findAllByText('Не привязан')).toHaveLength(2)
})

test('аккаунт уже у другого сотрудника — текст сервера под строкой', async () => {
  const text = 'Этот аккаунт Google уже привязан к другому сотруднику. Выберите другой аккаунт'
  backend(NOT_LINKED, () => HttpResponse.json({ detail: text, code: 'identity-taken' }, { status: 409 }))
  fakeGoogle()
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Вход через Google и Apple' })

  await user.click(within(section).getByRole('button', { name: 'Привязать Google' }))
  await user.click(await within(section).findByRole('button', { name: 'Продолжить с Google' }))

  expect(await within(section).findByRole('alert')).toHaveTextContent(text)
})

test('плохой токен — ошибка поля idToken из 422', async () => {
  backend(NOT_LINKED, () => HttpResponse.json({ detail: 'Проверьте поля формы',
    errors: [{ field: 'idToken', message: 'Не удалось подтвердить вход через Google — попробуйте ещё раз' }] }, { status: 422 }))
  fakeGoogle()
  const user = userEvent.setup()
  renderApp()
  const section = await screen.findByRole('region', { name: 'Вход через Google и Apple' })

  await user.click(within(section).getByRole('button', { name: 'Привязать Google' }))
  await user.click(await within(section).findByRole('button', { name: 'Продолжить с Google' }))

  expect(await within(section).findByRole('alert')).toHaveTextContent('Не удалось подтвердить вход через Google — попробуйте ещё раз')
})
