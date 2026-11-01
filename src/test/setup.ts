import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'

import { server } from './server'

// findBy/waitFor ждут до 5 с, а не 1 с по умолчанию: под нагрузкой (CI, параллельные прогоны)
// отрисовка после ответа MSW занимает дольше секунды, и тесты падали без причины. Успешный тест
// не ждёт дольше нужного — ожидание кончается, как только элемент появился
configure({ asyncUtilTimeout: 5000 })

// Запрос без обработчика MSW — ошибка теста: в сеть тесты не ходят
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
