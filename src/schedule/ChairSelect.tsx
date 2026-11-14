import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { useDebounced } from '../lib/useDebounced'
import { chairOf, useChairs } from '../team/chairs'
import { chairStateText } from './chairChoice'

type Option = Schemas['ChairOptionView']

/**
 * Поле «Кресло»: кресла клиники на выбранное время — «Кресло 1 (кресло врача) — занято (Айгерим С.)», «Кресло 2 —
 * свободно» (`/api/appointments/chair-options`). Занято приёмом — только «занято (кем)», без «время …». Что делать с
 * выбранным креслом (занято — «записать в «Кресло 2»», придёт уведомление врачу кресла) — одной строкой
 * {@link ChairTimeHint} под полем, а не второй подсказкой здесь.
 */
export function ChairSelect({ doctorId, startAt, duration, appointmentId, value, onChange }: {
  doctorId: number
  /** Начало приёма (UTC); null — время ещё не выбрано: только список кресел */
  startAt: string | null
  duration: number
  /** Приём, который переносят: его время не «занимает» кресло */
  appointmentId?: number
  value: number | undefined
  onChange: (chairId: number) => void
}) {
  const chairs = useChairs()
  const key = `${doctorId}|${startAt ?? ''}|${duration}|${appointmentId ?? ''}`
  const settled = useDebounced(key, 300)
  const valid = startAt != null && duration > 0 && !Number.isNaN(Date.parse(startAt))
  const endAt = valid ? new Date(Date.parse(startAt) + duration * 60_000).toISOString() : ''
  const options = useQuery({
    queryKey: ['chair-options', doctorId, startAt, endAt, appointmentId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/chair-options',
      { params: { query: { doctorId, startAt: startAt!, endAt, appointmentId } } })),
    enabled: valid && settled === key,
    staleTime: 30_000,
  })
  const own = chairOf(chairs.data, doctorId)?.id
  const list: Option[] = options.data ?? (chairs.data ?? []).map((c) => ({ id: c.id, name: c.name ?? '', own: c.id === own, state: 'FREE' as const, strict: false }))
  const known = Boolean(options.data)
  return (
    <label className="field"><span>Кресло</span>
      <Select value={value ?? ''} onChange={(e) => { if (e.target.value) onChange(Number(e.target.value)) }}>
        {value == null && <option value="">— без кресла —</option>}
        {list.map((o) => (
          <option key={o.id} value={o.id} disabled={known && o.state === 'BUSY' && o.id !== value}>
            {`${o.name}${o.own ? ' (кресло врача)' : ''}${known ? ` — ${chairStateText(o)}` : ''}`}
          </option>
        ))}
      </Select>
    </label>
  )
}
