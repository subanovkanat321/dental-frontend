import { useQueries, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { weekDays } from './weekModel'

/** Расписание само перечитывается раз в минуту, как «День». */
const REFRESH_MS = 60_000

/**
 * Приёмы врача за неделю — один запрос /api/appointments/range, и приём с воскресенья прошлой недели,
 * который идёт в понедельник после полуночи (overnight: ночная смена). Ключ начинается с 'appointments':
 * действия над приёмом (useAppointmentAction) обновляют и перечитывают недели так же, как дни.
 */
export function weekKey(monday: string, doctorId: number) {
  return ['appointments', 'week', monday, doctorId] as const
}

export function useWeekAppointments(monday: string, doctorId: number | null, enabled = true) {
  return useQuery({
    queryKey: weekKey(monday, doctorId ?? 0),
    queryFn: () => unwrap(api.GET('/api/appointments/range', { params: { query: { from: monday, days: 7, doctorId: doctorId!, overnight: true } } })),
    enabled: enabled && doctorId != null,
    refetchInterval: REFRESH_MS,
  })
}

/** Часы, перерывы, выходные и свободные окна врача на каждый день недели — тот же кэш, что у «Дня». */
export function useWeekSlots(monday: string, doctorId: number) {
  return useQueries({
    queries: weekDays(monday).map((date) => ({
      queryKey: ['slots', date, doctorId],
      queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId } } })),
      staleTime: 60_000,
      refetchInterval: REFRESH_MS,
    })),
  })
}
