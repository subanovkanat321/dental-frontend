import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from './client'

/** Подпись клиники и ссылка на её бота — для текстов пациентам в WhatsApp. */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(api.GET('/api/settings')),
    staleTime: 10 * 60_000,
  })
}

/** Лист ожидания клиники — им пользуются «Пациенты», карточка пациента и «Новая запись». */
export function useWaitlist() {
  return useQuery({
    queryKey: ['waitlist'],
    queryFn: () => unwrap(api.GET('/api/waitlist')),
  })
}
