import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'

/**
 * Долги из прежней программы (лист «Долги» шаблона переезда). Видит руководитель: другим сервер ответит
 * 403 — тогда список пуст, блока нет. Один ключ кэша на «Должников» и плитку итога.
 */
export function useOpeningDebts(patientId?: number) {
  return useQuery({
    queryKey: ['opening-debts', patientId ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/opening-debts', { params: { query: patientId ? { patientId } : {} } })),
    retry: false,
  })
}
