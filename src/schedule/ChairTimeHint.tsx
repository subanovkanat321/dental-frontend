import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { timeOf } from '../lib/time'
import { useDebounced } from '../lib/useDebounced'

/**
 * «🪑 Это время врача Айгерим (Кресло 1)» до нажатия «Записать»: выбранное время задевает часы коллеги по общему
 * креслу (V187). Спрашиваем сервер (`/api/appointments/chair-check`) — он отвечает той же логикой, что и запись
 * (409 chair-colleague-time): часы коллеги вне часов этого врача («Другое время»), ночные смены, перерывы,
 * «записывает сам коллега», прошедшее время. Раньше подсказка искала в `chairTime` слотов, а они обрезаны часами
 * записываемого врача — вечером «Другим временем» подсказки не было.
 *
 * @param action кнопка формы — «Записать», «Перенести», «Передать»: после неё сервер спросит «Коллега предупреждён?»
 */
export function ChairTimeHint({ doctorId, startAt, duration, action = 'Записать', chairId }: {
  doctorId: number; startAt: string; duration: number; action?: string
  /** Кресло, выбранное в форме (V210): часы врачей того кресла; нет — кресло врача */
  chairId?: number | null
}) {
  // «Другое время» печатают по цифре (22:0… → 22:04 → 22:43): спрашиваем, когда ввод замер, и не показываем
  // ответ про промежуточное время
  const key = `${doctorId}|${startAt}|${duration}|${chairId ?? ''}`
  const settled = useDebounced(key, 300)
  const valid = duration > 0 && !Number.isNaN(Date.parse(startAt))
  const endAt = valid ? new Date(Date.parse(startAt) + duration * 60_000).toISOString() : ''
  const check = useQuery({
    queryKey: ['chair-check', doctorId, startAt, endAt, chairId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/chair-check',
      { params: { query: { doctorId, startAt, endAt, chairId: chairId ?? undefined } } })),
    enabled: valid && settled === key,
    staleTime: 30_000,
  })
  const c = check.data?.colleague
  if (!c || settled !== key) return null
  const name = c.doctorName ?? 'коллеги'
  if (check.data?.strict) {
    return (
      <p className="notice tone-wait chair-time-hint" role="status">
        🪑 Это время врача {name} — записать нельзя, пусть {name} поставит себе перерыв.
      </p>
    )
  }
  return (
    <p className="notice tone-wait chair-time-hint" role="status">
      🪑 {timeOf(c.start!)}–{timeOf(c.end!)} — время врача {name}{c.chairName ? ` (${c.chairName})` : ''}.
      Предупредите коллегу: после «{action}» спросим, предупреждён ли он.
    </p>
  )
}
