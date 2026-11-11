import { MutationObserver, onlineManager, QueryObserver } from '@tanstack/react-query'

import { waitForSlow } from '../test/wait'
import { ApiError } from './client'
import { createQueryClient, retryOnce } from './queryClient'

afterEach(() => onlineManager.setOnline(true))

test('повторы: 4xx — нет, сеть и 5xx — один раз', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) expect(retryOnce(0, new ApiError(status, 'x'))).toBe(false)
  expect(retryOnce(0, new ApiError(0, 'Нет связи'))).toBe(true)
  expect(retryOnce(0, new ApiError(502, 'x'))).toBe(true)
  expect(retryOnce(0, new TypeError('x'))).toBe(true)
  expect(retryOnce(1, new ApiError(500, 'x'))).toBe(false)
})

test('запрос с 404 не повторяется', async () => {
  const client = createQueryClient()
  const fn = vi.fn(() => Promise.reject(new ApiError(404, 'Не найдено')))
  await expect(client.fetchQuery({ queryKey: ['x'], queryFn: fn })).rejects.toThrow('Не найдено')
  expect(fn).toHaveBeenCalledTimes(1)
})

test('401 у любого запроса — перечитать «кто вошёл»: App покажет вход', async () => {
  const client = createQueryClient({ queries: { retry: false } })
  const me = vi.fn(() => Promise.resolve({ doctor: true }))
  const unsubscribe = new QueryObserver(client, { queryKey: ['me'], queryFn: me }).subscribe(() => {})
  await waitForSlow(() => expect(me).toHaveBeenCalledTimes(1))
  await expect(client.fetchQuery({ queryKey: ['appointments'], queryFn: () => Promise.reject(new ApiError(401, 'Войдите')) })).rejects.toThrow()
  await waitForSlow(() => expect(me).toHaveBeenCalledTimes(2))
  // 403 — не про сессию: «кто вошёл» не трогаем
  await expect(client.fetchQuery({ queryKey: ['cash'], queryFn: () => Promise.reject(new ApiError(403, 'Нет прав')) })).rejects.toThrow()
  await new Promise((r) => setTimeout(r, 20))
  expect(me).toHaveBeenCalledTimes(2)
  unsubscribe()
})

test('401 у самого «кто вошёл» не зацикливается', async () => {
  const client = createQueryClient({ queries: { retry: false } })
  const me = vi.fn(() => Promise.reject(new ApiError(401, 'Войдите')))
  const unsubscribe = new QueryObserver(client, { queryKey: ['me'], queryFn: me }).subscribe(() => {})
  await new Promise((r) => setTimeout(r, 50))
  expect(me).toHaveBeenCalledTimes(1)
  unsubscribe()
})

test('без сети действие сразу падает «Нет связи», а не ждёт молча', async () => {
  const client = createQueryClient()
  onlineManager.setOnline(false)
  const observer = new MutationObserver(client, { mutationFn: () => Promise.reject(new ApiError(0, 'Нет связи с сервером')) })
  await expect(observer.mutate()).rejects.toThrow('Нет связи с сервером')
})
