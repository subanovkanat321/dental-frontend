import { MutationCache, QueryClient, type DefaultOptions } from '@tanstack/react-query'

import { ApiError } from './client'

/**
 * Клиент запросов приложения. Любое действие ответило 409 stale («данные только что изменились»:
 * правка с другого устройства, двойное нажатие) — перечитать всё, что на экране: текст сервера
 * покажет сама форма, а повторить действие можно уже по свежим данным.
 */
export function createQueryClient(defaultOptions?: DefaultOptions): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions,
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'stale') void client.invalidateQueries()
      },
    }),
  })
  return client
}
