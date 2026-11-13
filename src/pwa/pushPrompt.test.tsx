import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { me } from '../test/fixtures'
import { server } from '../test/server'
import { launchedAsApp } from './pwa'
import { PUSH_PROMPT_KEY, PushPrompt } from './PushPrompt'

/**
 * Окно «Включить уведомления» при первом запуске установленного приложения: когда показывается и
 * когда нет, две ветки (вход без Telegram / с Telegram), «Позже» запоминается, «Включить» подписывает
 * устройство и ставит канал APP. Браузер с push — подделки, как в notifications.test.tsx. Данные вымышленные.
 */

vi.mock('./pwa', async (original) => ({ ...await original<typeof import('./pwa')>(), launchedAsApp: vi.fn(() => true) }))

const KEY = 'BGPO-R-ciwlxnqDnJWaznK5snQSloWYBJEpgAE5J7H-N3Xtci0o0TJcaK8I5Z4dDmH3rbvyFmz7YgEG2k3eG9Z4'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device'
const WAIT = { timeout: 3000 }

function view(patch: Partial<Schemas['PushControllerPushView']> = {}): Schemas['PushControllerPushView'] {
  return { enabled: true, publicKey: KEY, channel: 'TELEGRAM', devices: [], noTelegram: false, ...patch }
}

function subscription(): PushSubscription {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'BPd-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  } as unknown as PushSubscription
}

function pushBrowser({ permission = 'default', answer = 'granted', subscribed = false }: {
  permission?: NotificationPermission
  answer?: NotificationPermission
  subscribed?: boolean
} = {}) {
  const requestPermission = vi.fn(() => Promise.resolve(answer))
  vi.stubGlobal('Notification', { permission, requestPermission })
  vi.stubGlobal('PushManager', function PushManager() {})
  const subscribe = vi.fn(() => Promise.resolve(subscription()))
  const pushManager = { subscribe, getSubscription: vi.fn(() => Promise.resolve(subscribed ? subscription() : null)) }
  const registration = { pushManager }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration), getRegistration: () => Promise.resolve(registration) },
    configurable: true,
  })
  return { requestPermission, subscribe }
}

/** Сервер: GET /api/push отдаёт `v`; считает запросы, запоминает тела подписки и канала. */
function backend(v = view()) {
  const calls = { get: 0, bodies: [] as unknown[] }
  server.use(
    http.get('*/api/push', () => { calls.get++; return HttpResponse.json(v) }),
    http.post('*/api/push/subscribe', async ({ request }) => { calls.bodies.push(await request.json()); return HttpResponse.json(v) }),
    http.put('*/api/push/channel', async ({ request }) => {
      calls.bodies.push(await request.json())
      return HttpResponse.json({ ...v, channel: 'APP', devices: ['Chrome · Android'] } satisfies Schemas['PushControllerPushView'])
    }),
  )
  return calls
}

function renderPrompt(who: Schemas['BookingViewsMe'] = me) {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}><PushPrompt me={who} /></QueryClientProvider>)
}

/** Дать окну время появиться (данные + пауза после тура) — и убедиться, что его нет. */
async function staysHidden() {
  await new Promise((r) => setTimeout(r, 1300))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}

afterEach(() => {
  vi.mocked(launchedAsApp).mockReturnValue(true)
  vi.unstubAllGlobals()
  delete window.Telegram
  Reflect.deleteProperty(navigator, 'serviceWorker')
  localStorage.removeItem(PUSH_PROMPT_KEY)
})

test('вход без Telegram: «🔔 Включить уведомления», иначе узнает только руководитель; «Включить» — подписка и канал APP', async () => {
  const browser = pushBrowser()
  const calls = backend(view({ channel: 'APP', noTelegram: true }))
  renderPrompt()
  const dialog = await screen.findByRole('dialog', { name: '🔔 Включить уведомления' }, WAIT)
  expect(dialog).toHaveTextContent('о записях узнает только руководитель')
  expect(screen.getByRole('button', { name: 'Позже' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Включить' }))
  expect(await screen.findByRole('dialog', { name: 'Готово ✓' })).toHaveTextContent('будут приходить в приложение')
  expect(browser.requestPermission).toHaveBeenCalled()
  expect(browser.subscribe).toHaveBeenCalled()
  expect(calls.bodies).toEqual([{ endpoint: ENDPOINT, p256dh: 'BPd-key', auth: 'auth-secret' }, { channel: 'APP' }])

  await userEvent.click(screen.getByRole('button', { name: 'Хорошо' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('есть Telegram: «вместо Telegram?»; «Оставить в Telegram» ничего не меняет и больше не спрашивает', async () => {
  const browser = pushBrowser()
  const calls = backend()
  const { unmount } = renderPrompt()
  await screen.findByRole('dialog', { name: 'Получать уведомления в приложение вместо Telegram?' }, WAIT)
  expect(screen.getByRole('button', { name: 'В приложение' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Оставить в Telegram' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(browser.requestPermission).not.toHaveBeenCalled()
  expect(calls.bodies).toEqual([])
  expect(localStorage.getItem(PUSH_PROMPT_KEY)).not.toBeNull()

  // Следующий запуск — флаг стоит: окна нет, на сервер даже не ходим
  unmount()
  calls.get = 0
  renderPrompt()
  await staysHidden()
  expect(calls.get).toBe(0)
})

test('есть Telegram: «В приложение» — разрешение, подписка, PUT channel APP', async () => {
  const browser = pushBrowser({ permission: 'granted', subscribed: true })
  const calls = backend()
  renderPrompt()
  await userEvent.click(await screen.findByRole('button', { name: 'В приложение' }, WAIT))
  expect(await screen.findByText(/в Telegram их больше не будет/)).toBeInTheDocument()
  expect(browser.requestPermission).toHaveBeenCalled()
  expect(calls.bodies).toContainEqual({ channel: 'APP' })
})

test('«Позже» ставит флаг на этом устройстве', async () => {
  pushBrowser()
  backend(view({ channel: 'APP', noTelegram: true }))
  renderPrompt()
  await userEvent.click(await screen.findByRole('button', { name: 'Позже' }, WAIT))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(localStorage.getItem(PUSH_PROMPT_KEY)).not.toBeNull()
})

test('браузер отказал — понятный текст и где включить потом; канал не трогаем', async () => {
  pushBrowser({ answer: 'denied' })
  const calls = backend()
  renderPrompt()
  await userEvent.click(await screen.findByRole('button', { name: 'В приложение' }, WAIT))
  const dialog = await screen.findByRole('dialog', { name: 'Уведомления запрещены' })
  expect(dialog).toHaveTextContent('по-прежнему будут приходить в Telegram')
  expect(dialog).toHaveTextContent('«Настройки» → «Уведомления»')
  expect(calls.bodies).toEqual([])
})

test('ошибка подписки — текст ошибки и подсказка, где включить потом (блок «Я» → «Уведомления»)', async () => {
  pushBrowser()
  server.use(
    http.get('*/api/push', () => HttpResponse.json(view())),
    http.post('*/api/push/subscribe', () => HttpResponse.json({ title: 'Ошибка', status: 500, detail: 'Сервер недоступен' }, { status: 500 })),
  )
  renderPrompt()
  await userEvent.click(await screen.findByRole('button', { name: 'В приложение' }, WAIT))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveTextContent('Включить можно потом: нажмите на своё имя внизу меню → «Уведомления».')
})

test('не установлено (вкладка браузера) — окна нет', async () => {
  vi.mocked(launchedAsApp).mockReturnValue(false)
  pushBrowser()
  const calls = backend()
  renderPrompt()
  await staysHidden()
  expect(calls.get).toBe(0)
})

test('в Telegram Mini App — окна нет', async () => {
  window.Telegram = { WebApp: { initData: 'query_id=1' } } as unknown as typeof window.Telegram
  pushBrowser()
  backend()
  renderPrompt()
  await staysHidden()
})

test('уведомления запрещены в браузере (denied) — окна нет', async () => {
  pushBrowser({ permission: 'denied' })
  backend()
  renderPrompt()
  await staysHidden()
})

test('браузер без push (например, iPhone в Safari) — окна нет', async () => {
  backend()
  renderPrompt()
  await staysHidden()
})

test('уже приходят в приложение на это устройство (канал APP, подписан) — окна нет', async () => {
  pushBrowser({ permission: 'granted', subscribed: true })
  const calls = backend(view({ channel: 'APP', devices: ['Chrome · Android'] }))
  renderPrompt()
  await waitFor(() => expect(calls.get).toBe(1))
  await staysHidden()
})

test('push на сервере выключен — окна нет', async () => {
  pushBrowser()
  backend(view({ enabled: false, publicKey: undefined }))
  renderPrompt()
  await staysHidden()
})

test('команде платформы без клиники — окна нет', async () => {
  pushBrowser()
  backend()
  renderPrompt({ ...me, doctor: false })
  await staysHidden()
})

test('тур ещё не пройден — ждём его; отметка «видел» — окно появляется', async () => {
  pushBrowser()
  backend()
  let seen = false
  server.use(http.get('*/api/me/tour', () => HttpResponse.json((seen ? { seenAt: '2026-11-13T05:00:00Z' } : {}) satisfies Schemas['StaffTourTourView'])))
  const client = createQueryClient({ queries: { retry: false } })
  render(<QueryClientProvider client={client}><PushPrompt me={me} /></QueryClientProvider>)
  await staysHidden()
  // Тур закрыли — Tour.tsx кладёт ответ PUT в тот же кэш
  seen = true
  client.setQueryData(['me-tour'], { seenAt: '2026-11-13T05:00:00Z' } satisfies Schemas['StaffTourTourView'])
  expect(await screen.findByRole('dialog', { name: 'Получать уведомления в приложение вместо Telegram?' }, WAIT)).toBeInTheDocument()
})
