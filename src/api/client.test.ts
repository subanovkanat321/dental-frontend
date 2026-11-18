import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'
import { server } from '../test/server'
import { api, ApiError, unwrap } from './client'

test('обрыв сети без интернета — ApiError со статусом 0 и пустыми fieldErrors, а не голый TypeError', async () => {
  // Интернет есть, а сервер молчит — это «Tish обновляется» (layout/updating.test.tsx)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  server.use(http.get('*/api/patient/me', () => HttpResponse.error()))
  const error = await unwrap(api.GET('/api/patient/me')).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  const e = error as ApiError
  expect(e.status).toBe(0)
  expect(e.message).toMatch(/Нет связи с сервером/)
  // Экраны берут первую ошибку поля так — у TypeError это падало (Object.values(undefined))
  expect(Object.values(e.fieldErrors)[0] ?? e.message).toMatch(/Нет связи/)
  vi.restoreAllMocks()
})
