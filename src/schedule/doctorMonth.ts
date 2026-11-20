import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { workDayOf } from './month/monthModel'

/** Состояние дня в мини-календаре врача. */
export type CalDay = { kind: 'work' | 'full' | 'off' | 'past-work' | 'past-off' | 'unknown'; freeMinutes: number; note?: string }

/** 150 → «2 ч 30 мин»; 0 → «0 мин». */
export function freeText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || '0 мин'
}

/**
 * Дни месяца врача: сегодня и дальше — /api/slots/month (сервер считает тем же расчётом, что сетку времени:
 * часы, перерывы, отпуска, кресла; FREE — есть окна и сколько свободно минут), прошедшие — по недельному графику
 * и выходным (/api/doctors/{id}/hours, /api/time-off — те же ключи кэша, что у «Месяца»): сервер их не считает.
 * «Сколько окон» сервер за месяц не отдаёт, а 30 запросов /api/slots ради числа — дорого: показываем, сколько
 * свободно часов (это и нужно регистратуре: «есть ли куда записать»).
 */
export function useDoctorMonth(doctorId: number, month: string): Record<string, CalDay> | undefined {
  const free = useQuery({
    queryKey: ['free-days', doctorId, month, null],
    queryFn: () => unwrap(api.GET('/api/slots/month', { params: { query: { doctorId, month } } })),
    staleTime: 60_000,
    retry: false,
  })
  const hours = useQuery({
    queryKey: ['doctor-hours', doctorId],
    queryFn: () => unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id: doctorId } } })),
    staleTime: 5 * 60_000,
  })
  const timeOff = useQuery({
    queryKey: ['time-off'],
    queryFn: () => unwrap(api.GET('/api/time-off')),
    staleTime: 5 * 60_000,
  })
  if (!free.data) return undefined
  const days: Record<string, CalDay> = {}
  for (const d of free.data) {
    if (d.state === 'FREE') days[d.date] = { kind: 'work', freeMinutes: d.freeMinutes }
    else if (d.state === 'FULL') days[d.date] = { kind: 'full', freeMinutes: 0 }
    else if (d.state === 'OFF') days[d.date] = { kind: 'off', freeMinutes: 0, note: d.note ?? undefined }
    else {
      const w = workDayOf(d.date, doctorId, hours.data, timeOff.data ?? [])
      days[d.date] = w == null ? { kind: 'unknown', freeMinutes: 0 }
        : w.off ? { kind: 'past-off', freeMinutes: 0, note: w.offTitle } : { kind: 'past-work', freeMinutes: 0 }
    }
  }
  return days
}

