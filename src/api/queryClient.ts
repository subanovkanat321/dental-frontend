import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query'

import { ApiError } from './client'

/**
 * Повторять ли упавший запрос: ответ 4xx (нет прав, не найдено, ошибка в данных, сессия кончилась)
 * повтор не исправит — сразу показываем ошибку. Обрыв связи (ApiError 0) и 5xx — один повтор:
 * сеть мигнула или сервер перезапускался.
 */
export function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
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
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      ...defaultOptions,
      queries: { retry: retryOnce, ...defaultOptions.queries },
      mutations: { networkMode: 'always', ...defaultOptions.mutations },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError) || error.status !== 401) return
        // Сам «кто вошёл» с 401 — это и есть экран входа; и не дёргаем его, пока он уже перечитывается
        if (query.queryKey[0] === 'me' || client.isFetching({ queryKey: ['me'] }) > 0) return
        void client.invalidateQueries({ queryKey: ['me'] })
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'stale') void client.invalidateQueries()
        // Действие с 401 — сессия кончилась: так же на вход
        else if (error instanceof ApiError && error.status === 401 && client.isFetching({ queryKey: ['me'] }) === 0) {
          void client.invalidateQueries({ queryKey: ['me'] })
        }
      },
    }),
  })
  return client
}
