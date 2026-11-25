import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { server } from '../test/server'
import { WhatsAppHealth } from './WhatsAppHealth'

type View = Schemas['WhatsAppAdminPlatformView']
type Connection = Schemas['WhatsAppAdminConnectionView']

// Только вымышленные клиники и номера
const clinicB: Connection = {
  clinicId: 7, clinicName: 'Клиника Б', wabaId: '900900900', phoneNumberId: '800800800', displayPhone: '+996 555 000 007',
  enabled: true, tokenOnServer: false, envClinic: false, tokenSet: false, appSecretSet: true, verifyTokenSet: false,
  unreadable: [], webhookReady: false, webhookPath: '/api/whatsapp/webhook/7', webhookErrors: 2,
  lastWebhookErrorAt: '2026-11-25T08:00:00Z',
}

const view = (connections: Connection[], secretsKey = true): View => ({
  enabled: true, webhookReady: false, graphVersion: 'v23.0', webhookPath: '/api/whatsapp/webhook', secretsKey,
  connections, last24h: {}, failures: [],
})

function renderHealth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><WhatsAppHealth /></QueryClientProvider>)
}

test('клиника: секреты — только «задан», адрес webhook клиники с копированием, ошибки webhook', async () => {
  server.use(http.get('*/api/platform/whatsapp', () => HttpResponse.json(view([clinicB]))))
  const user = userEvent.setup()
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderHealth()

  const card = await screen.findByRole('listitem', { name: 'Клиника Б №7' })
  expect(card).toHaveTextContent('Постоянный токен: не задан')
  expect(card).toHaveTextContent('App Secret: задан')
  expect(card).toHaveTextContent(`${window.location.origin}/api/whatsapp/webhook/7`)
  expect(card).toHaveTextContent('не принимает: нужны App Secret и verify token')
  expect(card).toHaveTextContent('ошибок webhook с запуска: 2')
  expect(screen.getByRole('table', { name: 'WhatsApp на сервере' })).toHaveTextContent('задан — секреты клиник хранятся зашифрованными')

  await user.click(within(card).getByRole('button', { name: 'Скопировать адрес webhook клиники №7' }))
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/api/whatsapp/webhook/7`)
  expect(within(card).getByRole('button', { name: /Скопировать адрес/ })).toHaveTextContent('Скопировано')
})

test('секреты: поля-пароли пустые, уходит только вписанное и «стереть», после сохранения форма закрыта', async () => {
  let sent: Schemas['WhatsAppControllerSecrets'] | undefined
  server.use(
    http.get('*/api/platform/whatsapp', () => HttpResponse.json(view([clinicB]))),
    http.put('*/api/platform/whatsapp/secrets', async ({ request }) => {
      sent = await request.json() as Schemas['WhatsAppControllerSecrets']
      return HttpResponse.json(view([{ ...clinicB, tokenSet: true, appSecretSet: false, tokenOnServer: true }]))
    }),
  )
  const user = userEvent.setup()
  renderHealth()

  const card = await screen.findByRole('listitem', { name: 'Клиника Б №7' })
  await user.click(within(card).getByRole('button', { name: 'Секреты' }))
  const form = screen.getByRole('form', { name: 'Секреты клиники' })
  const token = within(form).getByLabelText(/Постоянный токен/)
  expect(token).toHaveAttribute('type', 'password')
  expect(token).toHaveValue('')
  // Заданный App Secret сервер не отдаёт: поле пустое, можно только заменить или стереть
  const appSecret = within(form).getByLabelText(/^App Secret/)
  expect(appSecret).toHaveAttribute('type', 'password')
  expect(appSecret).toHaveValue('')
  expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled()

  await user.type(token, '  test-token-вымышленный-0001  ')
  await user.click(within(form).getByRole('checkbox', { name: /Стереть app secret/ }))
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))

  await waitFor(() => expect(screen.getByRole('listitem', { name: 'Клиника Б №7' })).toHaveTextContent('Постоянный токен: задан'))
  expect(sent).toEqual({ clinicId: 7, token: 'test-token-вымышленный-0001', clear: ['APP_SECRET'] })
  expect(screen.queryByRole('form', { name: 'Секреты клиники' })).not.toBeInTheDocument()
  // Значение нигде на экране не осталось
  expect(document.body.textContent).not.toContain('test-token-вымышленный-0001')
})

test('секреты: нет ключа на сервере — предупреждение и текст ошибки 409; ошибка поля — под полем', async () => {
  server.use(
    http.get('*/api/platform/whatsapp', () => HttpResponse.json(view([clinicB], false))),
    http.put('*/api/platform/whatsapp/secrets', () => HttpResponse.json(
      { status: 409, code: 'wa-no-secrets-key', detail: 'На сервере нет ключа WHATSAPP_SECRETS_KEY — секреты клиник не сохранить.' },
      { status: 409, headers: { 'Content-Type': 'application/problem+json' } })),
  )
  const user = userEvent.setup()
  renderHealth()

  expect(await screen.findByText('нет WHATSAPP_SECRETS_KEY — секреты клиник не сохранить')).toBeInTheDocument()
  await user.click(within(await screen.findByRole('listitem', { name: 'Клиника Б №7' })).getByRole('button', { name: 'Секреты' }))
  const form = screen.getByRole('form', { name: 'Секреты клиники' })
  expect(within(form).getAllByRole('alert')[0]).toHaveTextContent('На сервере нет WHATSAPP_SECRETS_KEY')
  await user.type(within(form).getByLabelText(/Verify token/), 'verify-вымышленный')
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByText(/секреты клиник не сохранить\.$/)).toBeInTheDocument()

  server.use(http.put('*/api/platform/whatsapp/secrets', () => HttpResponse.json(
    { status: 422, detail: 'Проверьте поля', errors: [{ field: 'verifyToken', message: 'От 8 до 256 символов, без пробелов' }] },
    { status: 422, headers: { 'Content-Type': 'application/problem+json' } })))
  await user.click(within(form).getByRole('button', { name: 'Сохранить' }))
  expect(await within(form).findByText('От 8 до 256 символов, без пробелов')).toBeInTheDocument()
})
