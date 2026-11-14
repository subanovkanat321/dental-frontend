import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { TimeInput } from '../layout/TimeInput'
import { useDirty } from '../lib/unsaved'
import { WEEK, type Weekday } from '../team/texts'
import { askMakeWorkday, DAYS, offLabel, onWeekday, useTimeOff, weeklyDaysOff } from '../team/dayOffHours'
import { ask } from '../lib/confirm'
import { clinicRequest } from './clinicUpdate'
import { canEditPrices, PRICES_BY_HEAD } from '../lib/roles'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Clinic = Schemas['ClinicView']

/**
 * «Часы клиники» — вверху «Рабочего времени → График»: по ним работают все, у кого нет своих часов
 * («как у клиники»). Меняет руководитель (как цены); остальным — только посмотреть.
 */
const NOTE = 'По ним работают все, у кого «как у клиники».'

export function ClinicHoursCard({ me, onTimeOff }: { me: Me; onTimeOff?: () => void }) {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  return (
    <section className="card-block clinic-hours" aria-label="Часы клиники">
      {clinic.isPending ? <Loading /> : clinic.error ? <p className="error">{clinic.error.message}</p>
        : <ClinicHours clinic={clinic.data} canEdit={canEditPrices(me)} admin={Boolean(me.admin)} onTimeOff={onTimeOff}
          note={me.admin ? NOTE : `${NOTE} ${PRICES_BY_HEAD}.`} />}
    </section>
  )
}

function ClinicHours({ clinic: c, canEdit, admin, onTimeOff, note }: {
  clinic: Clinic; canEdit: boolean; admin: boolean; onTimeOff?: () => void
  /** Мелко серым под строкой: кто работает по часам клиники */
  note: string
}) {
  const client = useQueryClient()
  // Еженедельный выходной всей клиники перекрывает рабочий день клиники
  const off = weeklyDaysOff(useTimeOff().data, null)
  const [start, setStart] = useState((c.workStart ?? '09:00').slice(0, 5))
  const [end, setEnd] = useState((c.workEnd ?? '18:00').slice(0, 5))
  const [days, setDays] = useState<Set<Weekday>>(new Set(c.workDays ?? WEEK.map(([code]) => code)))
  const { dirty, commit } = useDirty({ start, end, days: WEEK.map(([code]) => code).filter((code) => days.has(code)) })
  const save = useMutation<Clinic, ApiError, Set<Weekday>>({
    mutationFn: (week) => unwrap(api.PUT('/api/clinic', {
      body: clinicRequest(c, { workStart: start, workEnd: end, workDays: WEEK.map(([code]) => code).filter((code) => week.has(code)) }),
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['clinic'], saved)
      void client.invalidateQueries({ queryKey: ['me'] })
      // У кого «как у клиники» — в «Графике» новые часы
      for (const key of ['doctor-hours', 'staff-weekly', 'shifts']) void client.invalidateQueries({ queryKey: [key] })
    },
  })
  // Выходной всей клиники удаляет только админ: удалить запись, день — рабочий, часы — сохранить
  const dropOff = useMutation<unknown, ApiError, { id: number; week: Set<Weekday> }>({
    mutationFn: ({ id }) => unwrap(api.DELETE('/api/time-off/{id}', { params: { path: { id } } })),
    onSuccess: (_r, { week }) => save.mutate(week),
    onSettled: () => client.invalidateQueries({ queryKey: ['time-off'] }),
  })
  const toggle = (code: Weekday) => {
    save.reset()
    const t = off[code]
    if (t) {
      const next = new Set(days).add(code)
      if (!admin) {
        void ask(`${onWeekday(code)} выходной у всей клиники — убрать его может руководитель в «Перерывы и выходные»`, { ok: 'Понятно', single: true })
        return
      }
      void askMakeWorkday({ day: code, off: t, who: 'всей клиники', doctorHours: false, onTimeOff }).then((ok) => {
        if (!ok) return
        setDays(next)
        dropOff.mutate({ id: t.id, week: next })
      })
      return
    }
    const next = new Set(days)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDays(next)
  }
  return (
    <form className="clinic-hours-form" aria-label="Часы клиники" onSubmit={(e) => { e.preventDefault(); save.mutate(days) }}>
      {/* Компьютер — одной строкой «Часы клиники: [09:00] – [22:00] · Пн … Вс»; телефон — время и дни двумя строками */}
      <fieldset className="clinic-hours-line" disabled={!canEdit}>
        <legend className="sr-only">Часы и дни работы клиники</legend>
        <h2 className="clinic-hours-title">Часы клиники</h2>
        <span className="clinic-hours-time">
          <TimeInput step={15} aria-label="С" value={start} onChange={(v) => { save.reset(); setStart(v) }} />
          <span aria-hidden="true">–</span>
          <TimeInput step={15} aria-label="До" value={end} onChange={(v) => { save.reset(); setEnd(v) }} />
        </span>
        <div className="weekdays" role="group" aria-label="Рабочие дни клиники">
          {WEEK.map(([code, name, short]) => (
            <button key={code} type="button" className={off[code] ? 'day off' : 'day'} aria-label={name} aria-pressed={days.has(code) && !off[code]}
              title={off[code] ? `${offLabel(off[code])} — из «Перерывы и выходные»` : undefined}
              disabled={dropOff.isPending} onClick={() => toggle(code)}>{short}</button>
          ))}
        </div>
      </fieldset>
      <p className="hint small clinic-hours-note">
        <span>{note}</span>
        {DAYS.filter((code) => off[code]).map((code) => (
          <span key={code} className="hours-off">{onWeekday(code)}: {offLabel(off[code]!)} — из «Перерывы и выходные»</span>
        ))}
      </p>
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить часы клиники" savedText="Часы клиники сохранены"
        error={dropOff.error?.message ?? (save.error && (save.error.fieldErrors.workEnd ?? save.error.fieldErrors.workDays ?? save.error.message))} />}
    </form>
  )
}
