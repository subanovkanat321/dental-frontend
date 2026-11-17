import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import type { DayMark } from '../layout/DateInput'

/**
 * Свободные дни врача за месяц — зелёные дни в календаре (GET /api/slots/month). Считает сервер тем же расчётом,
 * что сетку времени: часы, перерывы и джума-намаз, отпуска, кресла. Кэш — по врачу, месяцу и длине приёма:
 * листаете месяцы туда-обратно — без новых запросов (минуту).
 */
export function useFreeDays(doctorId: number | null | undefined, month: string, duration?: number): Record<string, DayMark> | undefined {
  const q = useQuery({
    queryKey: ['free-days', doctorId, month, duration ?? null],
    queryFn: () => unwrap(api.GET('/api/slots/month', { params: { query: { doctorId: doctorId!, month, duration } } })),
    enabled: doctorId != null && /^\d{4}-\d{2}$/.test(month),
    staleTime: 60_000,
    retry: false,
  })
  if (!q.data) return undefined
  const marks: Record<string, DayMark> = {}
  for (const d of q.data) {
    if (d.state === 'FREE') marks[d.date] = { kind: 'free', hint: `свободно ${hours(d.freeMinutes)}` }
    else if (d.state === 'FULL') marks[d.date] = { kind: 'full', hint: 'свободного времени нет' }
    else if (d.state === 'OFF') marks[d.date] = { kind: 'off', hint: d.note ? d.note.toLowerCase() : 'выходной' }
  }
  return marks
}

/** 90 → «1 ч 30 мин», 480 → «8 ч». */
function hours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ') || '0 мин'
}
