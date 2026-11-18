import { useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './client'
import { retryDelay, retryWhileUpdating } from './queryClient'

/** Кто вошёл: сотрудник, его клиника и врачи — тот же /api/patient/me, что у Mini App. */
export function useMe() {
  // Повторы выключены во всём клиенте (тесты) — и здесь не повторяем
  const noRetry = useQueryClient().getDefaultOptions().queries?.retry === false
  return useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(api.GET('/api/patient/me')),
    // 401 — не вошли: повторять незачем, показываем вход. Tish обновляется — повторять, пока не вернётся
    // (а экран «Tish обновляется» ещё и сам перечитывает раз в 10 с)
    retry: noRetry ? false : retryWhileUpdating,
    retryDelay,
  })
}
