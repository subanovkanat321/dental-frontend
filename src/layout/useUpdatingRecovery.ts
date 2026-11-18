import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useUpdating } from '../api/updating'
import { useOnline } from '../lib/online'

/** Как часто, пока Tish обновляется, спрашивать сервер снова (запросы с ошибкой и «кто вошёл»). */
export const UPDATING_POLL_MS = 10_000

/** Перечитывать упавшие запросы после «сервер вернулся» не чаще раза в 30 с. */
const RECOVERY_GAP_MS = 30_000
let lastRecovery = 0

/** Запрос упал, потому что Tish обновлялся (или «кто вошёл» — по нему видно, что сервер вернулся). */
const failedWhileUpdating = (q: { state: { status: string }; queryKey: readonly unknown[] }) =>
  q.state.status === 'error' || q.queryKey[0] === 'me'

/**
 * Пока Tish обновляется: раз в {@link UPDATING_POLL_MS} перечитать запросы с ошибкой и «кто вошёл» (на
 * случай, если React Query уже перестал повторять сам). Сервер ответил — флаг снят (client.ts send), и
 * тогда перечитать запросы, упавшие за время обновления, — экраны с ошибкой оживают сами.
 * Только упавшие и не чаще раза в 30 с: если один адрес сломан насовсем (отвечает 502 без JSON), флаг
 * мигает «обновляется → ответил» — без паузы это была бы карусель запросов.
 */
export function useUpdatingRecovery(): boolean {
  const client = useQueryClient()
  const online = useOnline()
  const updating = useUpdating()
  const was = useRef(updating)
  useEffect(() => {
    if (was.current && !updating && Date.now() - lastRecovery >= RECOVERY_GAP_MS) {
      lastRecovery = Date.now()
      void client.refetchQueries({ type: 'active', predicate: (q) => q.state.status === 'error' }, { cancelRefetch: false })
    }
    was.current = updating
  }, [updating, client])
  useEffect(() => {
    if (!updating || !online) return
    const timer = setInterval(() => {
      void client.refetchQueries({ type: 'active', predicate: failedWhileUpdating }, { cancelRefetch: false })
    }, UPDATING_POLL_MS)
    return () => clearInterval(timer)
  }, [updating, online, client])
  return updating
}

/** Для тестов: забыть, когда перечитывали в последний раз. */
export function resetUpdatingRecovery(): void {
  lastRecovery = 0
}
