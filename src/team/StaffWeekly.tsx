import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { TimeInput } from '../layout/TimeInput'
import { Loading } from '../layout/Loading'
import { useDirty } from '../lib/unsaved'
import { WEEK, type Weekday } from './texts'
import { weeklyText } from './weekly'

type Weekly = Schemas['ShiftServiceWeekly']
type Day = { on: boolean; start: string; end: string }

/**
 * Недельный график сотрудника без кресла (V208): «Как у клиники» или свои дни и часы. Смены на даты
 * («Смены персонала») — поверх него: заменили, вышел в выходной. Меняет руководитель; остальным — текстом.
 */
export function StaffWeekly({ telegramId, canEdit }: { telegramId: number; canEdit: boolean }) {
  const loaded = useQuery({
    queryKey: ['staff-weekly', telegramId],
    queryFn: () => unwrap(api.GET('/api/shifts/weekly/{telegramId}', { params: { path: { telegramId } } })),
  })
  if (loaded.isPending) return <Loading />
  if (loaded.error) return <p className="error">{loaded.error.message}</p>
  if (!canEdit) {
    return <p>{loaded.data.custom ? weeklyText(loaded.data) : <>Как у клиники <span className="hint">— {weeklyText(loaded.data)}</span></>}</p>
  }
  return <WeeklyForm key={telegramId} telegramId={telegramId} loaded={loaded.data} />
}

function WeeklyForm({ telegramId, loaded }: { telegramId: number; loaded: Weekly }) {
  const client = useQueryClient()
  const byDay = Object.fromEntries((loaded.days ?? []).map((d) => [d.weekday, d]))
  const [custom, setCustom] = useState(Boolean(loaded.custom))
  const [days, setDays] = useState<Record<Weekday, Day>>(() => Object.fromEntries(WEEK.map(([code]) => [code, {
    on: Boolean(byDay[code]), start: (byDay[code]?.start ?? '09:00').slice(0, 5), end: (byDay[code]?.end ?? '18:00').slice(0, 5),
  }])) as Record<Weekday, Day>)
  const [error, setError] = useState('')
  const { dirty, commit } = useDirty(custom ? days : null)
  const save = useMutation<Weekly, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/shifts/weekly/{telegramId}', {
      params: { path: { telegramId } },
      body: { days: custom ? WEEK.filter(([code]) => days[code].on).map(([code]) => ({ weekday: code, start: days[code].start, end: days[code].end })) : [] },
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['staff-weekly', telegramId], saved)
      // График смен и «На смене» в сводке дня — по новому графику
      void client.invalidateQueries({ queryKey: ['shifts'] })
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
    const wrong = custom ? WEEK.find(([code]) => days[code].on && days[code].end <= days[code].start) : undefined
    if (wrong) {
      setError(`${wrong[1]}: конец — позже начала (график в пределах суток)`)
      return
    }
    save.mutate()
  }
  return (
    <div className="form" role="group" aria-label="Недельный график">
      <div className="segments" role="group" aria-label="Чей график">
        <button type="button" aria-pressed={!custom} onClick={() => { save.reset(); setCustom(false) }}>Как у клиники</button>
        <button type="button" aria-pressed={custom} onClick={() => { save.reset(); setCustom(true) }}>Свой график</button>
      </div>
      {!custom && <p className="hint">{loaded.custom ? 'После «Сохранить» — по часам клиники.' : `Сейчас: ${weeklyText(loaded)}.`}</p>}
      {custom && (
        <div className="hours">
          {WEEK.map(([code, name, short]) => (
            <div key={code} className="hours-row">
              <label title={name}><input type="checkbox" aria-label={name} checked={days[code].on} onChange={(e) => set(code, { on: e.target.checked })} /> {short}</label>
              <TimeInput step={15} aria-label={`${name}: с`} disabled={!days[code].on} value={days[code].start} onChange={(v) => set(code, { start: v })} />
              <span aria-hidden="true">–</span>
              <TimeInput step={15} aria-label={`${name}: до`} disabled={!days[code].on} value={days[code].end} onChange={(v) => set(code, { end: v })} />
            </div>
          ))}
        </div>
      )}
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить график" savedText="Недельный график сохранён"
        error={error || (save.error && (save.error.fieldErrors.days ?? save.error.message))} onSave={submit} />
    </div>
  )
}
