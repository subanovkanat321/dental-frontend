import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { useMe } from '../api/me'
import { seesAllMoney } from '../lib/roles'

/**
 * Долги из прежней программы (лист «Долги» шаблона переезда). Видит тот, кто видит деньги всей клиники
 * (сервер: requireMoneyAccess без врача → Staff.seesAllDoctors). Остальным не спрашиваем вовсе: раньше врач
 * в «Должниках» и в карточке пациента получал 403 — ошибка в консоли и в сети на каждом открытии.
 * Один ключ кэша на «Должников» и плитку итога.
 */
export function useOpeningDebts(patientId?: number, allowed = true) {
  const me = useMe().data
  return useQuery({
    queryKey: ['opening-debts', patientId ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/opening-debts', { params: { query: patientId ? { patientId } : {} } })),
    enabled: allowed && me != null && seesAllMoney(me),
    retry: false,
  })
}
