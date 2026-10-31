import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

import { server } from './server'

// Запрос без обработчика MSW — ошибка теста: в сеть тесты не ходят
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
