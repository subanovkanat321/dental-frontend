import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'
import { WEEK, type Weekday } from './texts'
import { Loading } from '../layout/Loading'
import { weekdaysText } from './timeOffTexts'
import { askMakeWorkday, offLabel, useTimeOff, weeklyDaysOff } from './dayOffHours'

type Day = { on: boolean; start: string; end: string }

/**
 * Дни и часы приёма врача — по ним свободное время в боте и самозапись. «Как у клиники» — общие
 * часы кабинета («О клинике»). Обед и намаз — не здесь, а в «Перерывах».
 * День с еженедельным выходным («Перерывы и выходные») — нерабочий: выходной перекрывает часы.
 * onTimeOff — открыть «Перерывы и выходные» (есть во вкладке «Рабочее время»).
 */
export function HoursEditor({ doctorId, doctorName, onTimeOff }: { doctorId: number; doctorName: string; onTimeOff?: () => void }) {
  const loaded = useQuery({
    queryKey: ['doctor-hours', doctorId],
    queryFn: () => unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id: doctorId } } })),
  })
  if (loaded.isPending) return <Loading />
  if (loaded.error) return <p className="error">{loaded.error.message}</p>
  return <HoursForm key={doctorId} doctorId={doctorId} doctorName={doctorName} onTimeOff={onTimeOff} loaded={loaded.data} />
}

function HoursForm({ doctorId, doctorName, onTimeOff, loaded }: {
  doctorId: number; doctorName: string; onTimeOff?: () => void; loaded: Schemas['DoctorHoursView']
}) {
  const client = useQueryClient()
  const off = weeklyDaysOff(useTimeOff().data, doctorId)
  const byDay = Object.fromEntries((loaded.days ?? []).map((d) => [d.weekday, d]))
  const [custom, setCustom] = useState(Boolean(loaded.custom))
  const [days, setDays] = useState<Record<Weekday, Day>>(() => Object.fromEntries(WEEK.map(([code]) => [code, {
    on: Boolean(byDay[code]), start: (byDay[code]?.start ?? '09:00').slice(0, 5), end: (byDay[code]?.end ?? '18:00').slice(0, 5),
  }])) as Record<Weekday, Day>)
  const [error, setError] = useState('')
  // «Как у клиники» — дни не важны: переключили туда-обратно без правок — правок нет
  const { dirty, commit } = useDirty(custom ? days : null)
  // Дни передаём в mutate: «сделать рабочей» сохраняет сразу, не дожидаясь нового состояния
  const save = useMutation<Schemas['DoctorHoursView'], ApiError, Record<Weekday, Day>>({
    mutationFn: (week) => unwrap(api.PUT('/api/doctors/{id}/hours', {
      params: { path: { id: doctorId } },
      body: { days: custom ? WEEK.filter(([code]) => week[code].on).map(([code]) => ({ weekday: code, start: week[code].start, end: week[code].end })) : [] },
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['doctor-hours', doctorId], saved)
      // Подсказка «часы пересекаются с соседом по креслу» — по новым часам
      void client.invalidateQueries({ queryKey: ['chairs'] })
    },
  })
  const set = (code: Weekday, patch: Partial<Day>) => {
    save.reset()
    setError('')
    setDays({ ...days, [code]: { ...days[code], ...patch } })
  }
  // Убрать выходной этого врача: удалить запись «Перерывов и выходных», день — рабочий, часы — сохранить
  const dropOff = useMutation<unknown, ApiError, { id: number; week: Record<Weekday, Day> }>({
    mutationFn: ({ id }) => unwrap(api.DELETE('/api/time-off/{id}', { params: { path: { id } } })),
    onSuccess: (_r, { week }) => save.mutate(week),
    onSettled: () => client.invalidateQueries({ queryKey: ['time-off'] }),
  })
  const check = (code: Weekday, on: boolean) => {
    const t = off[code]
    if (!on || !t) return set(code, { on })
    void askMakeWorkday({ day: code, off: t, who: doctorName, doctorHours: true, onTimeOff }).then((ok) => {
      if (!ok) return
      const week = { ...days, [code]: { ...days[code], on: true } }
      setDays(week)
      setError('')
      save.reset()
      dropOff.mutate({ id: t.id!, week })
    })
  }
  const submit = () => {
    setError('')
    if (custom && !WEEK.some(([code]) => days[code].on && !off[code])) {
      setError('Отметьте хотя бы один рабочий день')
      return
    }
    save.mutate(days)
  }

  return (
    <div className="form" aria-label="Часы работы" role="group">
      <div className="segments" role="group" aria-label="Чьи часы">
        <button type="button" aria-pressed={!custom} onClick={() => { save.reset(); setCustom(false) }}>Как у клиники</button>
        <button type="button" aria-pressed={custom} onClick={() => { save.reset(); setCustom(true) }}>Свои часы</button>
      </div>
      {!custom && Object.keys(off).length > 0 && (
        <p className="hint">Выходной из «Перерывы и выходные»: {weekdaysText(Object.keys(off) as Weekday[]).toLowerCase()}.</p>
      )}
      {custom && (
        <div className="hours">
          {WEEK.map(([code, name, short]) => {
            const t = off[code]
            // Выходной перекрывает часы: галочка снята, вместо часов — откуда выходной. Сами часы дня
            // не трогаем: удалят выходной в «Перерывах и выходных» — день снова рабочий, как был
            return (
              <div key={code} className={t ? 'hours-row off' : 'hours-row'}>
                <label title={name}><input type="checkbox" aria-label={name} checked={days[code].on && !t} disabled={dropOff.isPending}
                  onChange={(e) => check(code, e.target.checked)} /> {short}</label>
                {t ? <span className="hours-off">{offLabel(t)} — из «Перерывы и выходные»{t.doctorId == null ? ' (вся клиника)' : ''}</span> : <>
                  <input type="time" step={900} aria-label={`${name}: с`} disabled={!days[code].on} value={days[code].start} onChange={(e) => set(code, { start: e.target.value })} />
                  <span aria-hidden="true">–</span>
                  <input type="time" step={900} aria-label={`${name}: до`} disabled={!days[code].on} value={days[code].end} onChange={(e) => set(code, { end: e.target.value })} />
                </>}
              </div>
            )
          })}
        </div>
      )}
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить часы" savedText="Часы работы сохранены"
        error={error || dropOff.error?.message || (save.error && (save.error.fieldErrors.days ?? save.error.message))} onSave={submit} />
    </div>
  )
}
