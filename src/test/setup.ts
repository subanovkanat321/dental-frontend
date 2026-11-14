import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'

import { resetSubs } from '../lib/sub'
import { resetPlatformModes } from '../platform/modes'
import { closeHelpChat } from '../lib/helpChat'
import { DEFAULT_NOW, fixNow } from './now'
import { server } from './server'

// findBy/waitFor ждут до 5 с, а не 1 с по умолчанию: под нагрузкой (CI, параллельные прогоны)
// отрисовка после ответа MSW занимает дольше секунды, и тесты падали без причины. Успешный тест
// не ждёт дольше нужного — ожидание кончается, как только элемент появился
configure({ asyncUtilTimeout: 5000 })

// «Сейчас» в тестах — всегда полдень одного и того же буднего дня (test/now.ts): тесты с датами и временем
// («12–20 ноября», линия «сейчас», «прошедшие приёмы», todayIn() на уровне модуля) не зависят от реального
// времени суток и даты. Тест, которому нужно своё время, зовёт fixNow сам
// До импорта файла теста: todayIn() на уровне модуля берёт тот же день
fixNow(DEFAULT_NOW)
beforeEach(() => { fixNow(DEFAULT_NOW) })

// Запрос без обработчика MSW — ошибка теста: в сеть тесты не ходят
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
  // Подраздел (#/cash/salary) запоминается в модуле — следующий тест начинает с подраздела по умолчанию
  resetSubs()
  resetPlatformModes()
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
