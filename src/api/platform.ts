import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from './client'

/** Кто отвечает за платформу и как с ней связаться — для «Техподдержки», «Оплаты» и «Конфиденциальности». */
export function usePlatformInfo() {
  return useQuery({ queryKey: ['platform-info'], queryFn: () => unwrap(api.GET('/api/platform-info')), staleTime: 30 * 60_000 })
}
