/**
 * Подождать, пока проверка пройдёт, — до 5 с, а не до 1 с, как голый `vi.waitFor`: под нагрузкой (CI,
 * параллельные прогоны) отрисовка после ответа MSW занимает дольше секунды, и тесты падали без
 * причины. Как `asyncUtilTimeout` у findBy/waitFor (setup.ts). Успешный тест не ждёт дольше нужного.
 * Голый `vi.waitFor` без опций запрещён в eslint.config.js.
 */
export function waitForSlow<T>(callback: () => T | Promise<T>, options: { timeout?: number; interval?: number } = {}): Promise<T> {
  return vi.waitFor(callback, { timeout: 5000, interval: 50, ...options })
}

/**
 * Загрузить заранее ленивые модули CRM (`lazy` в App.tsx: оболочка и «Расписание»). Иначе первый тест файла
 * ждёт, пока Vite соберёт весь граф модулей раздела, внутри своих 5 с `findBy`: на нагруженной машине это
 * 10–17 с, и тест падал «Unable to find … Следующий день» — кнопка не успевала появиться, хотя она на месте.
 * Вызов: `beforeAll(warmSchedule, 60_000)` — у хука свой срок, тесты ждут как обычно.
 */
export async function warmSchedule(): Promise<void> {
  await Promise.all([import('../layout/Shell'), import('../schedule/SchedulePage')])
}
