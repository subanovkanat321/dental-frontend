import { useQuery } from '@tanstack/react-query'

import { reminderText } from '../lib/texts'
import { api, unwrap, type Schemas } from './client'
import { useMe } from './me'

/** Подпись клиники, ссылка на её бота и свой текст напоминания — для текстов пациентам в WhatsApp. */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(api.GET('/api/settings')),
    staleTime: 10 * 60_000,
  })
}

/**
 * Текст напоминания о приёме для WhatsApp/SMS: свой текст клиники или стандартный, ссылка на бота,
 * {врач} — из врачей клиники (/api/patient/me, уже в кэше). null — настройки ещё грузятся.
 */
export function useReminderText(): ((a: Schemas['AppointmentView']) => string) | null {
  const settings = useSettings()
  const me = useMe()
  const data = settings.data
  if (!data) return null
  return (a) => reminderText({ startAt: a.startAt!, serviceName: a.serviceName, patient: a.patient ?? {} }, data,
    me.data?.doctors?.find((d) => d.id === a.doctorId)?.fullName)
}

/** Лист ожидания клиники — им пользуются «Пациенты», карточка пациента и «Новая запись». */
export function useWaitlist(enabled = true) {
  return useQuery({
    queryKey: ['waitlist'],
    queryFn: () => unwrap(api.GET('/api/waitlist')),
    enabled,
  })
}
