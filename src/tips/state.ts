import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'

/** Что сервер помнит о советах человека (GET /api/me/tips, V233 бэкенда). */
export const TIPS_KEY = ['me-tips'] as const

/** Совет, который сервер разрешил показать сегодня, — живёт до закрытия, пока открыто приложение (ушли в другой раздел и вернулись — он на месте). */
export const TIP_CARD_KEY = ['me-tips-card'] as const

export function useTipsState(enabled: boolean) {
  return useQuery({ queryKey: TIPS_KEY, queryFn: () => unwrap(api.GET('/api/me/tips')), enabled, staleTime: 10 * 60_000, retry: false })
}

/** «Не показывать советы» (true) / «Показывать советы снова» (false) — одно и то же в карточке и в «Помощи». Сразу на сервер. */
export function useTipsOff() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (off: boolean) => unwrap(api.PUT('/api/me/tips/off', { body: { off } })),
    onSuccess: (r) => client.setQueryData(TIPS_KEY, r),
  })
}
