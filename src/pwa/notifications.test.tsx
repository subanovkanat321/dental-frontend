import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { server } from '../test/server'
import { Notifications } from './Notifications'
import { resetPwa } from './pwa'

const KEY = 'BGPO-R-ciwlxnqDnJWaznK5snQSloWYBJEpgAE5J7H-N3Xtci0o0TJcaK8I5Z4dDmH3rbvyFmz7YgEG2k3eG9Z4'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device'

function view(patch: Partial<Schemas['PushControllerPushView']> = {}): Schemas['PushControllerPushView'] {
  return { enabled: true, publicKey: KEY, channel: 'TELEGRAM', devices: [], ...patch }
}

function subscription(): PushSubscription {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'BPd-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  } as unknown as PushSubscription
}

/** Браузер с push: Notification, PushManager и service worker с pushManager — подделки на время теста. */
function pushBrowser({ permission = 'default', answer = 'granted', subscribed = false }: {
  permission?: NotificationPermission
  answer?: NotificationPermission
  subscribed?: boolean
} = {}) {
  const requestPermission = vi.fn(() => Promise.resolve(answer))
  vi.stubGlobal('Notification', { permission, requestPermission })
  vi.stubGlobal('PushManager', function PushManager() {})
  const subscribe = vi.fn((options: PushSubscriptionOptionsInit) => { void options; return Promise.resolve(subscription()) })
  const pushManager = { subscribe, getSubscription: vi.fn(() => Promise.resolve(subscribed ? subscription() : null)) }
  const registration = { pushManager }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration), getRegistration: () => Promise.resolve(registration) },
    configurable: true,
  })
  return { requestPermission, subscribe }
}

function renderBlock() {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><Notifications /></QueryClientProvider>)
}

beforeEach(() => resetPwa())
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.Telegram
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

test('в Telegram — только «уведомления приходят в бот», без выбора', () => {
  window.Telegram = { WebApp: { initData: 'query_id=1' } } as unknown as typeof window.Telegram
  renderBlock()
  expect(screen.getByRole('region', { name: 'Уведомления' })).toHaveTextContent('уведомления приходят сюда, в бот')
  expect(screen.queryByRole('group', { name: 'Куда присылать уведомления' })).not.toBeInTheDocument()
})

test('на сервере не включено — блока нет', async () => {
  const seen = vi.fn()
  server.use(http.get('*/api/push', () => { seen(); return HttpResponse.json(view({ enabled: false, publicKey: undefined })) }))
  renderBlock()
  await waitFor(() => expect(seen).toHaveBeenCalled())
  expect(screen.queryByRole('region', { name: 'Уведомления' })).not.toBeInTheDocument()
})

test('браузер без push — «не умеет уведомления», «В приложение» недоступно', async () => {
  server.use(http.get('*/api/push', () => HttpResponse.json(view())))
  renderBlock()
  expect(await screen.findByText(/Этот браузер не умеет уведомления/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'В приложение' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true')
})

test('iPhone в Safari — сначала установить на экран «Домой», iOS 16.4+', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE)
  server.use(http.get('*/api/push', () => HttpResponse.json(view())))
  renderBlock()
  expect(await screen.findByText(/только в установленное приложение \(iOS 16\.4 и новее\)/)).toBeInTheDocument()
})

test('разрешение запрещено — как разрешить; подписки и смены канала нет', async () => {
  const browser = pushBrowser({ answer: 'denied' })
  const changed = vi.fn()
  server.use(
    http.get('*/api/push', () => HttpResponse.json(view())),
    http.put('*/api/push/channel', () => { changed(); return HttpResponse.json(view({ channel: 'APP' })) }),
  )
  renderBlock()
  await userEvent.click(await screen.findByRole('button', { name: 'В приложение' }))
  expect(browser.requestPermission).toHaveBeenCalled()
  expect(await screen.findByText(/запрещены в браузере/)).toBeInTheDocument()
  expect(browser.subscribe).not.toHaveBeenCalled()
  expect(changed).not.toHaveBeenCalled()
})

test('«В приложение»: разрешение, подписка ключом сервера, сохранение — «Работает ✓» и проверочное', async () => {
  const browser = pushBrowser()
  const bodies: unknown[] = []
  server.use(
    http.get('*/api/push', () => HttpResponse.json(view())),
    http.post('*/api/push/subscribe', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(view({ devices: ['Chrome · Android'] }))
    }),
    http.put('*/api/push/channel', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(view({ channel: 'APP', devices: ['Chrome · Android'] }))
    }),
    http.post('*/api/push/test', () => HttpResponse.json({ sent: 1 } satisfies Schemas['PushControllerTestResult'])),
  )
  renderBlock()
  await userEvent.click(await screen.findByRole('button', { name: 'В приложение' }))

  expect(await screen.findByText(/Работает ✓/)).toBeInTheDocument()
  expect(browser.requestPermission).toHaveBeenCalled()
  const options = browser.subscribe.mock.calls[0]![0]
  expect(options.userVisibleOnly).toBe(true)
  expect((options.applicationServerKey as Uint8Array).length).toBe(65)
  expect(bodies).toEqual([{ endpoint: ENDPOINT, p256dh: 'BPd-key', auth: 'auth-secret' }, { channel: 'APP' }])
  expect(screen.getByRole('button', { name: 'В приложение' })).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(screen.getByRole('button', { name: '🔔 Отправить проверочное' }))
  expect(await screen.findByText(/Отправили на 1 устройство: Chrome · Android/)).toBeInTheDocument()
})

test('выбрано приложение, но это устройство не подключено — на каких приходят и «Подключить»', async () => {
  pushBrowser({ permission: 'granted' })
  server.use(http.get('*/api/push', () => HttpResponse.json(view({ channel: 'APP', devices: ['Safari · iPhone'] }))))
  renderBlock()
  expect(await screen.findByText('Уведомления приходят на: Safari · iPhone. Это устройство не подключено.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Подключить это устройство' })).toBeInTheDocument()
})

test('выбрано приложение без устройств — предупреждение: пока в Telegram', async () => {
  pushBrowser({ permission: 'granted' })
  server.use(http.get('*/api/push', () => HttpResponse.json(view({ channel: 'APP' }))))
  renderBlock()
  expect(await screen.findByText(/Ни одно устройство не подключено — пока уведомления идут в Telegram/)).toBeInTheDocument()
})

test('вернуться в Telegram — сохраняет канал TELEGRAM', async () => {
  pushBrowser({ permission: 'granted', subscribed: true })
  let saved: unknown
  server.use(
    http.get('*/api/push', () => HttpResponse.json(view({ channel: 'APP', devices: ['Chrome · Windows'] }))),
    http.put('*/api/push/channel', async ({ request }) => { saved = await request.json(); return HttpResponse.json(view()) }),
  )
  renderBlock()
  expect(await screen.findByText(/Работает ✓/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Telegram' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true'))
  expect(saved).toEqual({ channel: 'TELEGRAM' })
})

test('вход без Telegram: канала Telegram нет; не включил — «иначе получит администратор», включил — «Работает ✓»', async () => {
  pushBrowser()
  const bodies: unknown[] = []
  server.use(
    http.get('*/api/push', () => HttpResponse.json(view({ channel: 'APP', noTelegram: true }))),
    http.post('*/api/push/subscribe', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(view({ channel: 'APP', noTelegram: true, devices: ['Chrome · Android'] }))
    }),
    http.put('*/api/push/channel', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(view({ channel: 'APP', noTelegram: true, devices: ['Chrome · Android'] }))
    }),
  )
  renderBlock()
  const block = await screen.findByRole('region', { name: 'Уведомления' })
  await waitFor(() => expect(block).toHaveTextContent('Включите уведомления приложения, иначе сообщения о записях получит администратор.'))
  expect(screen.queryByRole('group', { name: 'Куда присылать уведомления' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Telegram' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Включить уведомления' }))
  expect(await screen.findByText('Работает ✓ Уведомления приходят в приложение.')).toBeInTheDocument()
  expect(bodies).toEqual([{ endpoint: ENDPOINT, p256dh: 'BPd-key', auth: 'auth-secret' }, { channel: 'APP' }])
})
