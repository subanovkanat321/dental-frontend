/**
 * Подождать, пока проверка пройдёт, — до 5 с, а не до 1 с, как голый `vi.waitFor`: под нагрузкой (CI,
 * параллельные прогоны) отрисовка после ответа MSW занимает дольше секунды, и тесты падали без
 * причины. Как `asyncUtilTimeout` у findBy/waitFor (setup.ts). Успешный тест не ждёт дольше нужного.
 * Голый `vi.waitFor` без опций запрещён в eslint.config.js.
 */
export function waitForSlow<T>(callback: () => T | Promise<T>, options: { timeout?: number; interval?: number } = {}): Promise<T> {
  return vi.waitFor(callback, { timeout: 5000, interval: 50, ...options })
}
