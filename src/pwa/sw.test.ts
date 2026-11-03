import source from './sw.js?raw'

type Handler = (event: Record<string, unknown>) => void

/** sw.js в поддельном self: ловим обработчики push и notificationclick. */
function loadWorker(windows: { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }[] = []) {
  const handlers: Record<string, Handler> = {}
  const self = {
    location: new URL('https://tish.test/sw.js'),
    addEventListener: (type: string, handler: Handler) => { handlers[type] = handler },
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: { matchAll: vi.fn(() => Promise.resolve(windows)), openWindow: vi.fn(() => Promise.resolve(null)), claim: vi.fn() },
    skipWaiting: vi.fn(),
  }
  new Function('self', 'caches', 'fetch', source)(self, {}, vi.fn())
  return { handlers, self }
}

async function dispatch(handler: Handler, event: Record<string, unknown>) {
  let waited: Promise<unknown> = Promise.resolve()
  handler({ ...event, waitUntil: (p: Promise<unknown>) => { waited = p } })
  await waited
}

test('push — уведомление с текстом, значком Тишки и tag, куда открыть', async () => {
  const { handlers, self } = loadWorker()
  const data = { title: 'Новая заявка', body: '🆕 Заявка на завтра', url: '/?appointment=12', tag: 'Новая заявка:appointment=12' }
  await dispatch(handlers.push!, { data: { json: () => data, text: () => JSON.stringify(data) } })
  expect(self.registration.showNotification).toHaveBeenCalledWith('Новая заявка', expect.objectContaining({
    body: '🆕 Заявка на завтра', icon: '/icon-192.png', tag: 'Новая заявка:appointment=12', data: { url: '/?appointment=12' },
  }))
})

test('нажали — открытая CRM на передний план и на приём; чужой адрес не открываем', async () => {
  const open = { url: 'https://tish.test/#/schedule', focus: vi.fn(() => Promise.resolve()), navigate: vi.fn(() => Promise.resolve()) }
  const { handlers, self } = loadWorker([open])
  const close = vi.fn()
  await dispatch(handlers.notificationclick!, { notification: { close, data: { url: '/?appointment=12' } } })
  expect(close).toHaveBeenCalled()
  expect(open.focus).toHaveBeenCalled()
  expect(open.navigate).toHaveBeenCalledWith('https://tish.test/?appointment=12')
  expect(self.clients.openWindow).not.toHaveBeenCalled()

  const empty = loadWorker([])
  await dispatch(empty.handlers.notificationclick!, { notification: { close, data: { url: 'https://evil.example/' } } })
  expect(empty.self.clients.openWindow).toHaveBeenCalledWith('https://tish.test/')
})

test('видео — мимо service worker (плееру нужны куски по Range), а JS сборки — из кэша', () => {
  const { handlers } = loadWorker()
  const fetchEvent = (path: string) => {
    const respondWith = vi.fn()
    handlers.fetch!({ request: { method: 'GET', url: `https://tish.test${path}`, mode: 'no-cors', headers: new Headers() }, respondWith })
    return respondWith
  }
  expect(fetchEvent('/assets/kak-ustanovit-abc123.mp4')).not.toHaveBeenCalled()
  const js = fetchEvent('/assets/index-abc123.js')
  expect(js).toHaveBeenCalled()
  // Ответ из кэша не ждём: в поддельном self кэша нет — гасим отказ, чтобы он не всплыл после теста
  ;(js.mock.calls[0]![0] as Promise<unknown>).catch(() => {})
})
