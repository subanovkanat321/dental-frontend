import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { TimeInput } from '../layout/TimeInput'
import { useDirty } from '../lib/unsaved'
import { WEEK, type Weekday } from './texts'
import { isNightShift } from '../lib/time'
import { Loading } from '../layout/Loading'
import { weekdaysText } from './timeOffTexts'
import { askMakeWorkday, offLabel, useTimeOff, weeklyDaysOff } from './dayOffHours'
import { dayHours, weekKey, weekSummary, type Who } from './workWeek'

type Day = { on: boolean; start: string; end: string }
type Loaded = { custom: boolean; days?: { weekday?: string; start?: string; end?: string }[] }

function load(who: Who): Promise<Loaded> {
  return who.kind === 'doctor'
    ? unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id: who.id } } }))
    : unwrap(api.GET('/api/shifts/weekly/{telegramId}', { params: { path: { telegramId: who.telegramId } } }))
}

function store(who: Who, days: { weekday: Weekday; start: string; end: string }[]): Promise<Loaded> {
  return who.kind === 'doctor'
    ? unwrap(api.PUT('/api/doctors/{id}/hours', { params: { path: { id: who.id } }, body: { days } }))
    : unwrap(api.PUT('/api/shifts/weekly/{telegramId}', { params: { path: { telegramId: who.telegramId } }, body: { days } }))
}

/**
 * Обычная неделя человека клиники — один редактор для врача и для сотрудника («Клиника → Рабочее время →
 * График», карточка врача и сотрудника в «Персонале»): «Как у клиники» или свои дни и часы. Сохраняет
 * туда, где неделя хранится (`who`). Отличия врача — от модели: у него по часам свободное время в записи,
 * поэтому можно ночную смену (конец раньше начала — до утра след. дня, смена относится к дню начала),
 * а еженедельный выходной из «Перерывов и выходных» перекрывает его день. Неделя сотрудника — в пределах
 * суток; замены и выходы на дату — смены поверх неё («Неделя по датам»).
 * onTimeOff — открыть «Перерывы и выходные» (есть во вкладке «Рабочее время»). canEdit=false — текстом.
 */
export function WeekEditor({ who, canEdit = true, onTimeOff }: { who: Who; canEdit?: boolean; onTimeOff?: () => void }) {
  const loaded = useQuery({ queryKey: weekKey(who), queryFn: () => load(who) })
  if (loaded.isPending) return <Loading />
  if (loaded.error) return <p className="error">{loaded.error.message}</p>
  if (!canEdit) {
    const text = weekSummary(dayHours(loaded.data.days))
    return <p>{loaded.data.custom ? text : <>Как у клиники <span className="hint">— {text}</span></>}</p>
  }
  return <WeekForm key={weekKey(who).join()} who={who} onTimeOff={onTimeOff} loaded={loaded.data} />
}

/** Часы врача — {@link WeekEditor} врача (карточка врача, «Мой профиль»). */
export function HoursEditor({ doctorId, doctorName, onTimeOff }: { doctorId: number; doctorName: string; onTimeOff?: () => void }) {
  return <WeekEditor who={{ kind: 'doctor', id: doctorId, name: doctorName }} onTimeOff={onTimeOff} />
}

function WeekForm({ who, onTimeOff, loaded }: { who: Who; onTimeOff?: () => void; loaded: Loaded }) {
  const client = useQueryClient()
  const doctor = who.kind === 'doctor'
  const timeOff = useTimeOff()
  // Еженедельный выходной перекрывает рабочий день — только у врачей (по ним запись)
  const off = doctor ? weeklyDaysOff(timeOff.data, who.id) : {}
  const byDay = Object.fromEntries((loaded.days ?? []).map((d) => [d.weekday, d]))
  const [custom, setCustom] = useState(Boolean(loaded.custom))
  const [days, setDays] = useState<Record<Weekday, Day>>(() => Object.fromEntries(WEEK.map(([code]) => [code, {
    on: Boolean(byDay[code]), start: (byDay[code]?.start ?? '09:00').slice(0, 5), end: (byDay[code]?.end ?? '18:00').slice(0, 5),
  }])) as Record<Weekday, Day>)
  const [error, setError] = useState('')
  // «Как у клиники» — дни не важны: переключили туда-обратно без правок — правок нет
  const { dirty, commit } = useDirty(custom ? days : null)
  // Дни передаём в mutate: «сделать рабочей» сохраняет сразу, не дожидаясь нового состояния
  const save = useMutation<Loaded, ApiError, Record<Weekday, Day>>({
    mutationFn: (week) => store(who, custom
      ? WEEK.filter(([code]) => week[code].on).map(([code]) => ({ weekday: code, start: week[code].start, end: week[code].end })) : []),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(weekKey(who), saved)
      // Врач: подсказка «часы пересекаются с соседом по креслу»; сотрудник: график и «На смене» в сводке дня
      void client.invalidateQueries({ queryKey: [doctor ? 'chairs' : 'shifts'] })
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
    void askMakeWorkday({ day: code, off: t, who: who.name, doctorHours: true, onTimeOff }).then((ok) => {
      if (!ok) return
      const week = { ...days, [code]: { ...days[code], on: true } }
      setDays(week)
      setError('')
      save.reset()
      dropOff.mutate({ id: t.id, week })
    })
  }
  const submit = () => {
    setError('')
    if (custom && !WEEK.some(([code]) => days[code].on && !off[code])) {
      setError('Отметьте хотя бы один рабочий день')
      return
    }
    const wrong = custom ? WEEK.find(([code]) => days[code].on && !off[code]
      && (doctor ? days[code].start === days[code].end : days[code].end <= days[code].start)) : undefined
    if (wrong) {
      setError(doctor ? `${wrong[1]}: начало и конец совпадают — для ночной смены укажите, до скольких утра`
        : `${wrong[1]}: конец — позже начала (у персонала смена в пределах суток)`)
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
      {!custom && !doctor && <p className="hint">{loaded.custom ? 'После «Сохранить» — по часам клиники.' : `Сейчас: ${weekSummary(dayHours(loaded.days))}.`}</p>}
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
                  <TimeInput step={15} aria-label={`${name}: с`} disabled={!days[code].on} value={days[code].start} onChange={(v) => set(code, { start: v })} />
                  <span aria-hidden="true">–</span>
                  <TimeInput step={15} aria-label={`${name}: до`} disabled={!days[code].on} value={days[code].end} onChange={(v) => set(code, { end: v })} />
                  {doctor && days[code].on && isNightShift(days[code].start, days[code].end) && <span className="hours-night hint">🌙 до утра след. дня</span>}
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
