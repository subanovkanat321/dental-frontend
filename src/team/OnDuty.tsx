import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../api/client'

/** '09:00:00' → «09», '09:30:00' → «09:30» — коротко, как в утренней сводке бота. */
function shortHour(time?: string): string {
  const hm = (time ?? '').slice(0, 5)
  return hm.endsWith(':00') ? hm.slice(0, 2) : hm
}

/**
 * «Кто на смене» в «Сводке дня»: «Айпери 09–15 · Бермет 15–21» из «Графика смен». Только имена
 * сотрудников и время. Смен в этот день нет (или график не ведут) — блока нет совсем.
 */
export function OnDuty({ date }: { date: string }) {
  const loaded = useQuery({
    queryKey: ['shifts', date, date],
    queryFn: () => unwrap(api.GET('/api/shifts', { params: { query: { from: date, to: date } } })),
  })
  const people = loaded.data?.people ?? []
  const shifts = (loaded.data?.shifts ?? []).filter((s) => people.some((p) => p.telegramId === s.telegramId))
  if (!shifts.length) return null
  const nameOf = (id?: number) => people.find((p) => p.telegramId === id)?.fullName ?? ''
  return (
    <section className="ds-block" aria-label="На смене">
      <h2 className="ds-title">На смене</h2>
      <p className="hint">
        {shifts.map((s) => `${nameOf(s.telegramId)} ${shortHour(s.startTime)}–${shortHour(s.endTime)}`).join(' · ')}
      </p>
    </section>
  )
}
