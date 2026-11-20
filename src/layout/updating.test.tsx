import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { api, ApiError, isUpdatingError, unwrap, UPDATING_ACTION_TEXT } from '../api/client'
import { retryDelay, retryOnce, UPDATING_RETRIES } from '../api/queryClient'
import { isUpdatingNow, setUpdating } from '../api/updating'
import { me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import offlineHtml from '../../public/offline.html?raw'
import { UPDATING_POLL_MS } from './useUpdatingRecovery'

/**
 * «Tish обновляется» ≠ «нет интернета»: во время ./deploy/update.sh сервер не отвечает или nginx
 * отвечает 503 «Приложение обновляется» (Retry-After 30) — показываем спокойную плашку, повторяем
 * запросы сами; настоящий обрыв сети (navigator.onLine false) — прежнее «Нет интернета».
 */
const NGINX_503 = () => HttpResponse.json(
  { status: 503, title: 'Service Unavailable', detail: 'Приложение обновляется. Повторите через минуту.' },
  { status: 503, headers: { 'Retry-After': '30', 'Content-Type': 'application/problem+json; charset=utf-8' } },
)

beforeEach(() => setUpdating(false))

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  act(() => onlineManager.setOnline(true))
  // Сеть вернулась — отложенные запросы (например, «Совет дня» читает /api/platform-info) уходят сразу; дождаться их
  // здесь, иначе ответ придёт в следующем тесте и снимет флаг «обновляется» посреди его проверки
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
})

/** Сервер работал, потом «упал» (down — все /api отвечают fail), сотрудник вернулся во вкладку — запросы перечитываются. */
async function serverGoesDown(fail: () => Response) {
  const state = { down: false, calls: 0 }
  server.use(
    http.all('*/api/*', () => {
      if (!state.down) return undefined
      state.calls += 1
      return fail()
    }),
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  state.down = true
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
  return state
}

test('503 от nginx — плашка «обновляется» и повтор сам; сервер ответил — плашки нет, данные перечитаны', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const state = await serverGoesDown(NGINX_503)
  expect(await screen.findByText('Tish обновляется — минутку…')).toBeInTheDocument()
  expect(screen.queryByText(/Нет интернета/)).not.toBeInTheDocument()
  // Красной ошибки с текстом nginx нет, CRM на месте
  expect(screen.queryByText(/Приложение обновляется/)).not.toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  state.down = false
  await act(() => vi.advanceTimersByTimeAsync(UPDATING_POLL_MS))
  await waitFor(() => expect(screen.queryByText('Tish обновляется — минутку…')).not.toBeInTheDocument())
  expect(isUpdatingNow()).toBe(false)
  focusManager.setFocused(undefined)
})

test('обрыв при включённой сети — «обновляется», а не «нет интернета»', async () => {
  await serverGoesDown(() => HttpResponse.error())
  expect(await screen.findByText('Tish обновляется — минутку…')).toBeInTheDocument()
  expect(screen.queryByText(/Нет интернета/)).not.toBeInTheDocument()
  focusManager.setFocused(undefined)
})

test('сети нет (navigator.onLine false) — прежнее «Нет связи… проверьте интернет» и плашка «Нет интернета»', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  server.use(http.get('*/api/patient/me', () => HttpResponse.error()))
  const error = await unwrap(api.GET('/api/patient/me')).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).status).toBe(0)
  expect((error as ApiError).message).toMatch(/проверьте интернет/)
  expect(isUpdatingNow()).toBe(false)

  vi.restoreAllMocks()
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(me)),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  renderApp()
  await screen.findByRole('navigation', { name: 'Разделы' })
  act(() => onlineManager.setOnline(false))
  expect(screen.getByText(/Нет интернета — проверьте связь/)).toBeInTheDocument()
  expect(screen.queryByText('Tish обновляется — минутку…')).not.toBeInTheDocument()
})

test('действие при 503 — понятный текст и без автоповтора', async () => {
  let posts = 0
  server.use(http.post('*/api/appointments/:id/remind-telegram', () => {
    posts += 1
    return NGINX_503()
  }))
  const error = await unwrap(api.POST('/api/appointments/{id}/remind-telegram', { params: { path: { id: 1 } } })).catch((e: unknown) => e)
  expect(isUpdatingError(error)).toBe(true)
  expect((error as ApiError).status).toBe(503)
  expect((error as ApiError).message).toBe(UPDATING_ACTION_TEXT)
  expect(posts).toBe(1)
  expect(isUpdatingNow()).toBe(true)
})

test('502 и 503 самого приложения (JSON без Retry-After) — обычная ошибка с текстом сервера', async () => {
  server.use(http.get('*/api/patient/me', () => HttpResponse.json({ status: 502, detail: 'Telegram не ответил' }, { status: 502 })))
  const error = await unwrap(api.GET('/api/patient/me')).catch((e: unknown) => e)
  expect(isUpdatingError(error)).toBe(false)
  expect((error as ApiError).message).toBe('Telegram не ответил')

  // 502 от прокси — страница HTML, не JSON: это перезапуск
  server.use(http.get('*/api/patient/me', () => new HttpResponse('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })))
  expect(isUpdatingError(await unwrap(api.GET('/api/patient/me')).catch((e: unknown) => e))).toBe(true)
})

test('повторы «обновляется»: до 12 раз, пауза по Retry-After в пределах 5–10 с', () => {
  const nginx = new ApiError(503, 'x', {}, { code: 'updating', retryAfter: 30 })
  const dropped = new ApiError(503, 'x', {}, { code: 'updating' })
  expect(retryOnce(UPDATING_RETRIES - 1, nginx)).toBe(true)
  expect(retryOnce(UPDATING_RETRIES, nginx)).toBe(false)
  expect(retryDelay(0, nginx)).toBe(10_000)
  expect(retryDelay(0, dropped)).toBe(5_000)
  // Обычная 503 (SMS не подключены) — как раньше: один повтор
  expect(retryOnce(1, new ApiError(503, 'x'))).toBe(false)
})

test('на запуске Tish обновляется — экран «подождите», а не тупик; ответил — открывается CRM', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let down = true
  server.use(
    http.get('*/api/patient/me', () => (down ? NGINX_503() : HttpResponse.json(me))),
    http.get('*/api/appointments', () => HttpResponse.json([])),
  )
  renderApp()
  expect(await screen.findByRole('heading', { name: 'Tish обновляется' })).toBeInTheDocument()
  expect(screen.getByText(/всё продолжится само/)).toBeInTheDocument()
  expect(screen.queryByText(/Нет связи с сервером/)).not.toBeInTheDocument()
  down = false
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  expect(await screen.findByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  expect(screen.queryByText('Tish обновляется — минутку…')).not.toBeInTheDocument()
})

test('offline.html: «Нет связи с Tish», про обновление и сама обновляется (meta refresh, без скриптов)', () => {
  const doc = new DOMParser().parseFromString(offlineHtml, 'text/html')
  expect(doc.querySelector('h1')?.textContent).toBe('Нет связи с Tish')
  expect(doc.body.textContent).toContain('Если интернет у вас есть — Tish, скорее всего, обновляется')
  expect(doc.body.textContent).toContain('страница обновится сама')
  expect(doc.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content')).toBe('20')
  expect(doc.querySelector('a')?.textContent).toBe('Обновить')
  // CSP не пускает встроенные скрипты — их и нет
  expect(doc.querySelector('script')).toBeNull()
})
