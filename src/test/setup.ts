import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'

import { resetSubs } from '../lib/sub'
import { closeHelpChat } from '../lib/helpChat'
import { server } from './server'

// findBy/waitFor ждут до 5 с, а не 1 с по умолчанию: под нагрузкой (CI, параллельные прогоны)
// отрисовка после ответа MSW занимает дольше секунды, и тесты падали без причины. Успешный тест
// не ждёт дольше нужного — ожидание кончается, как только элемент появился
configure({ asyncUtilTimeout: 5000 })

// «Сегодня» в тестах — всегда один и тот же будний день: тесты с датами («12–20 ноября», todayIn() на
// уровне модуля) не падают после 20 ноября и 1 января. Подменяем только Date (таймеры настоящие), и
// время идёт дальше (shouldAdvanceTime) — staleTime React Query и задержки работают как обычно.
// Тест, которому нужно своё время, ставит его сам (vi.setSystemTime); TEST_NOW — проверить на другой дате
const NOW = process.env.TEST_NOW ?? '2026-11-11T06:00:00Z'
function pinDate() {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(NOW))
}
// До импорта файла теста: todayIn() на уровне модуля берёт тот же день
pinDate()
beforeEach(pinDate)

// Запрос без обработчика MSW — ошибка теста: в сеть тесты не ходят
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
  // Подраздел (#/cash/salary) запоминается в модуле — следующий тест начинает с подраздела по умолчанию
  resetSubs()
  // Чат помощника открыт в модуле (lib/helpChat.ts) — следующий тест начинает с закрытым
  closeHelpChat()
})
afterAll(() => server.close())

// Подтверждения (lib/confirm → layout/ConfirmHost): тест подменил window.confirm — отвечаем через
// подмену, как раньше системным окном (проверки текста вопроса работают). Не подменил — окно ждёт
// нажатия в тесте (confirm.test.tsx).
import { pending as pendingConfirm, subscribe as onConfirm } from '../lib/confirm'
import { act } from '@testing-library/react'
onConfirm(() => {
  const p = pendingConfirm()
  if (p && vi.isMockFunction(window.confirm)) {
    const answer = window.confirm(p.text)
    queueMicrotask(() => act(() => p.resolve(answer)))
  }
})
