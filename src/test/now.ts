/**
 * «Сейчас» в тестах. Тесты не зависят от реального времени суток и даты: setup.ts до каждого теста
 * ставит DEFAULT_NOW — полдень буднего дня по Бишкеку. Тест, которому нужно другое время (ночь,
 * полночь, выходные, «приём ещё не начался»), зовёт fixNow сам — следующий тест снова начнёт с DEFAULT_NOW.
 *
 * Подменяем только Date: setTimeout/setInterval настоящие — React Query, MSW и задержки работают как обычно.
 * TEST_NOW=2026-11-13T21:00:00Z npx vitest run — прогнать набор на другом «сейчас» (проверить, что тесты не
 * завязаны на конкретный день).
 */
export const DEFAULT_NOW = process.env.TEST_NOW ?? '2026-11-11T12:00:00+06:00'

/**
 * Зафиксировать «сейчас»: fixNow('2026-11-12T23:30:00+06:00'). По умолчанию часы идут дальше от этой точки
 * (staleTime и «через 300 мс» работают); frozen: true — часы стоят (точное «10:47» в тексте).
 */
export function fixNow(at: string | Date, { frozen = false }: { frozen?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: !frozen })
  vi.setSystemTime(new Date(at))
}
