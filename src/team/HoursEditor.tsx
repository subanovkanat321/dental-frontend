import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'
import { WEEK, type Weekday } from './texts'
import { Loading } from '../layout/Loading'

type Day = { on: boolean; start: string; end: string }

/**
 * Дни и часы приёма врача — по ним свободное время в боте и самозапись. «Как у клиники» — общие
 * часы кабинета («О клинике»). Обед и намаз — не здесь, а в «Перерывах».
 */
export function HoursEditor({ doctorId }: { doctorId: number }) {
  const loaded = useQuery({
    queryKey: ['doctor-hours', doctorId],
    queryFn: () => unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id: doctorId } } })),
  })
  if (loaded.isPending) return <Loading />
  if (loaded.error) return <p className="error">{loaded.error.message}</p>
  return <HoursForm key={doctorId} doctorId={doctorId} loaded={loaded.data} />
}

function HoursForm({ doctorId, loaded }: { doctorId: number; loaded: Schemas['DoctorHoursView'] }) {
  const client = useQueryClient()
  const byDay = Object.fromEntries((loaded.days ?? []).map((d) => [d.weekday, d]))
  const [custom, setCustom] = useState(Boolean(loaded.custom))
  const [days, setDays] = useState<Record<Weekday, Day>>(() => Object.fromEntries(WEEK.map(([code]) => [code, {
    on: Boolean(byDay[code]), start: (byDay[code]?.start ?? '09:00').slice(0, 5), end: (byDay[code]?.end ?? '18:00').slice(0, 5),
  }])) as Record<Weekday, Day>)
  const [error, setError] = useState('')
  // «Как у клиники» — дни не важны: переключили туда-обратно без правок — правок нет
  const { dirty, commit } = useDirty(custom ? days : null)
  const save = useMutation<Schemas['DoctorHoursView'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/doctors/{id}/hours', {
      params: { path: { id: doctorId } },
      body: { days: custom ? WEEK.filter(([code]) => days[code].on).map(([code]) => ({ weekday: code, start: days[code].start, end: days[code].end })) : [] },
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['doctor-hours', doctorId], saved)
    },
  })
  const set = (code: Weekday, patch: Partial<Day>) => {
    save.reset()
    setError('')
    setDays({ ...days, [code]: { ...days[code], ...patch } })
  }
  const submit = () => {
    setError('')
    if (custom && !WEEK.some(([code]) => days[code].on)) {
      setError('Отметьте хотя бы один рабочий день')
      return
    }
    save.mutate()
  }

  return (
    <div className="form" aria-label="Часы работы" role="group">
      <div className="segments" role="group" aria-label="Чьи часы">
        <button type="button" aria-pressed={!custom} onClick={() => { save.reset(); setCustom(false) }}>Как у клиники</button>
        <button type="button" aria-pressed={custom} onClick={() => { save.reset(); setCustom(true) }}>Свои часы</button>
      </div>
      {custom && (
        <div className="hours">
          {WEEK.map(([code, name, short]) => (
            <div key={code} className="hours-row">
              <label title={name}><input type="checkbox" aria-label={name} checked={days[code].on} onChange={(e) => set(code, { on: e.target.checked })} /> {short}</label>
              <input type="time" step={900} aria-label={`${name}: с`} disabled={!days[code].on} value={days[code].start} onChange={(e) => set(code, { start: e.target.value })} />
              <span aria-hidden="true">–</span>
              <input type="time" step={900} aria-label={`${name}: до`} disabled={!days[code].on} value={days[code].end} onChange={(e) => set(code, { end: e.target.value })} />
            </div>
          ))}
        </div>
      )}
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить часы" savedText="Часы работы сохранены"
        error={error || (save.error && (save.error.fieldErrors.days ?? save.error.message))} onSave={submit} />
    </div>
  )
}
