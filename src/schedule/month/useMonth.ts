import { useQueries, useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { daysInMonth } from './monthModel'

/** Расписание само перечитывается раз в минуту, как «День» и «Неделя». */
const REFRESH_MS = 60_000

/**
 * Данные «Месяца»: приёмы — один запрос /api/appointments/range на врача за весь месяц (до 31 дня),
 * а не 30 запросов «день»; недельный график врача (/api/doctors/{id}/hours) и перерывы с выходными
 * (/api/time-off, один на клинику) — чтобы посчитать загрузку и нерабочие дни без /api/slots на каждый
 * день. Ключ приёмов начинается с 'appointments': действия над приёмом перечитывают и месяц.
 */
export function useMonthData(month: string, doctorIds: number[], enabled: boolean) {
  const appointments = useQueries({
    queries: doctorIds.map((id) => ({
      queryKey: ['appointments', 'month', month, id],
      queryFn: () => unwrap(api.GET('/api/appointments/range', { params: { query: { from: `${month}-01`, days: daysInMonth(month), doctorId: id } } })),
      enabled,
      refetchInterval: REFRESH_MS,
    })),
  })
  // Тот же ключ, что у «Настройки → Перерывы и выходные»: график и выходные общие в кэше
  const hours = useQueries({
    queries: doctorIds.map((id) => ({
      queryKey: ['doctor-hours', id],
      queryFn: () => unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id } } })),
      enabled,
      staleTime: 5 * 60_000,
    })),
  })
  const timeOff = useQuery({
    queryKey: ['time-off'],
    queryFn: () => unwrap(api.GET('/api/time-off')),
    enabled,
    staleTime: 5 * 60_000,
  })
  return {
    appointments: appointments.flatMap((q) => q.data ?? []),
    hours: doctorIds.map((id, i) => ({ id, hours: hours[i]?.data })),
    timeOff: timeOff.data ?? [],
    pending: appointments.some((q) => q.isPending),
    error: appointments.find((q) => q.error)?.error ?? null,
  }
}
