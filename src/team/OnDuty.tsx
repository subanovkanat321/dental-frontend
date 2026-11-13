import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'
import { plannedOn } from './weekly'

/** '09:00:00' → «09», '09:30:00' → «09:30» — коротко, как в утренней сводке бота. */
function shortHour(time?: string): string {
  const hm = (time ?? '').slice(0, 5)
  return hm.endsWith(':00') ? hm.slice(0, 2) : hm
}

/**
 * «Кто на смене» в «Сводке дня»: «Айпери 09–15 · Бермет 15–21» — смены на дату, а у кого смены нет —
 * свой недельный график (V208). «Как у клиники» не показываем, как и утренняя сводка бота: иначе блок
 * был бы у каждой клиники каждый день. Только имена сотрудников и время.
 */
export function OnDuty({ date }: { date: string }) {
  const loaded = useQuery({
    queryKey: ['shifts', date, date],
    queryFn: () => unwrap(api.GET('/api/shifts', { params: { query: { from: date, to: date } } })),
  })
  const people = loaded.data?.people ?? []
  const shifts = (loaded.data?.shifts ?? []).filter((s) => people.some((p) => p.telegramId === s.telegramId))
  const nameOf = (id?: number) => people.find((p) => p.telegramId === id)?.fullName ?? ''
  const data = loaded.data
  const planned = data ? people.filter((p) => !shifts.some((s) => s.telegramId === p.telegramId)
    && data.weekly?.find((w) => w.telegramId === p.telegramId)?.custom).flatMap((p) => {
    const day = plannedOn(data, p.telegramId, date)
    return day ? [{ telegramId: p.telegramId, startTime: day.start, endTime: day.end }] : []
  }) : []
  const all = [...shifts, ...planned].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  if (!all.length) return null
  return (
    <section className="ds-block" aria-label="На смене">
      <h2 className="ds-title">На смене</h2>
      <p className="hint">
        {all.map((s) => `${nameOf(s.telegramId)} ${shortHour(s.startTime)}–${shortHour(s.endTime)}`).join(' · ')}
      </p>
    </section>
  )
}
