import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query'

import { ApiError, isUpdatingError, retryAfterSeconds } from './client'

/**
 * Сколько раз повторять чтение, пока Tish обновляется: 12 раз по 5–10 с — около двух минут, обычное
 * обновление укладывается. Дальше запросы перечитывает плашка «обновляется» (useUpdatingRecovery).
 */
export const UPDATING_RETRIES = 12

/**
 * Повторять ли упавший запрос: ответ 4xx (нет прав, не найдено, ошибка в данных, сессия кончилась)
 * повтор не исправит — сразу показываем ошибку. Tish обновляется (ApiError 'updating') — повторять,
 * пока не вернётся (до {@link UPDATING_RETRIES}). Обрыв связи (ApiError 0) и 5xx — один повтор.
 */
export function retryOnce(failureCount: number, error: unknown): boolean {
  if (isUpdatingError(error)) return failureCount < UPDATING_RETRIES
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

/** Только «обновляется» — для запросов, которые в остальном не повторяются («кто вошёл»). */
export function retryWhileUpdating(failureCount: number, error: Error): boolean {
  return isUpdatingError(error) && failureCount < UPDATING_RETRIES
}

/**
 * Пауза перед повтором: Tish обновляется — сколько советует nginx (Retry-After), но в пределах 5–10 с
 * (nginx говорит 30 с с запасом, а обычно сервер встаёт раньше); остальное — как в React Query по умолчанию.
 */
export function retryDelay(failureCount: number, error: Error): number {
  if (isUpdatingError(error)) return Math.min(10, Math.max(5, retryAfterSeconds(error) ?? 5)) * 1000
  return Math.min(1000 * 2 ** failureCount, 30_000)
}

/**
 * Клиент запросов приложения (CRM и Mini App пациента — один на всех, main.tsx).
 * - Любое действие ответило 409 stale («данные только что изменились»: правка с другого устройства,
 *   двойное нажатие) — перечитать всё, что на экране: текст сервера покажет сама форма, а повторить
 *   действие можно уже по свежим данным.
 * - Любой запрос ответил 401 (сессия кончилась, пока вкладка была открыта) — перечитать «кто вошёл»
 *   (['me']): тот тоже получит 401, и App покажет вход вместо экрана с ошибками.
 * - Действия (мутации) — networkMode 'always': без сети запрос уходит сразу и падает «Нет связи»
 *   (ApiError 0), а не ждёт молча, пока связь вернётся, с вечным «Сохраняем…».
 */
export function createQueryClient(defaultOptions: DefaultOptions = {}): QueryClient {
  // Перечитать «кто вошёл» — только если сейчас вошли (на экране входа 401 — норма) и он уже не перечитывается
  const sessionExpired = () => {
    if (client.getQueryState(['me'])?.status !== 'success' || client.isFetching({ queryKey: ['me'] }) > 0) return
    void client.invalidateQueries({ queryKey: ['me'] })
  }
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      ...defaultOptions,
      queries: { retry: retryOnce, retryDelay, ...defaultOptions.queries },
      mutations: { networkMode: 'always', ...defaultOptions.mutations },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError) || error.status !== 401) return
        if (query.queryKey[0] !== 'me') sessionExpired()
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'stale') void client.invalidateQueries()
        // Действие с 401 — сессия кончилась: так же на вход
        else if (error instanceof ApiError && error.status === 401) sessionExpired()
      },
    }),
  })
  return client
}
