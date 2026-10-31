import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from './client'

/** Кто вошёл: сотрудник, его клиника и врачи — тот же /api/patient/me, что у Mini App. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(api.GET('/api/patient/me')),
    // 401 — не вошли: повторять незачем, показываем вход
    retry: false,
  })
}
