import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { TimeInput } from '../layout/TimeInput'
import { useDirty } from '../lib/unsaved'
import { HoursEditor } from '../team/HoursEditor'
import { WEEK, type Weekday } from '../team/texts'
import { askMakeWorkday, DAYS, offLabel, onWeekday, useTimeOff, weeklyDaysOff } from '../team/dayOffHours'
import { ask } from '../lib/confirm'
import { clinicRequest } from './clinicUpdate'
import { SubHeader } from './SubHeader'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Clinic = Schemas['ClinicView']

/**
 * «Часы работы» одним экраном: часы клиники (по ним работают врачи без своих часов) и часы
 * каждого врача — раскрыть и поменять. Врач видит свои, админ и регистратура — всех.
 */
export function HoursPage({ me, onBack, title = 'Часы работы', tabs, onTimeOff }: {
  me: Me; onBack: () => void; title?: string; tabs?: React.ReactNode; onTimeOff?: () => void
}) {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
    .filter((d) => me.admin || me.reception || d.id === me.doctorId)
  const [open, setOpen] = useState<number | null>(doctors.length === 1 ? doctors[0]!.id! : me.doctorId ?? null)
  return (
    <section className="schedule-main">
      <SubHeader title={title} onBack={onBack}>{tabs}</SubHeader>
      <section className="card-block">
        <h2>Часы клиники</h2>
        {clinic.isPending ? <Loading /> : clinic.error ? <p className="error">{clinic.error.message}</p>
          : <ClinicHours clinic={clinic.data} canEdit={Boolean(me.admin || me.doctorId != null)} admin={Boolean(me.admin)} onTimeOff={onTimeOff} />}
      </section>
      <section className="card-block">
        <h2>Часы врачей</h2>
        <p className="hint">У каждого врача свои дни и часы: по ним свободное время в боте и в «Новой записи». Не задал — работает по часам клиники. Обед и намаз — в «Перерывах и выходных».</p>
        {doctors.map((d) => (
          <div key={d.id} className="hours-doctor">
            <button type="button" className="hours-toggle" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id!)}>
              <strong>{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</strong><span aria-hidden="true">{open === d.id ? '▴' : '▾'}</span>
            </button>
            {open === d.id && <HoursEditor doctorId={d.id!} doctorName={d.fullName ?? ''} onTimeOff={onTimeOff} />}
          </div>
        ))}
      </section>
    </section>
  )
}

function ClinicHours({ clinic: c, canEdit, admin, onTimeOff }: { clinic: Clinic; canEdit: boolean; admin: boolean; onTimeOff?: () => void }) {
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
        dropOff.mutate({ id: t.id!, week: next })
      })
      return
    }
    const next = new Set(days)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDays(next)
  }
  return (
    <form className="form" aria-label="Часы клиники" onSubmit={(e) => { e.preventDefault(); save.mutate(days) }}>
      <fieldset className="form" disabled={!canEdit}>
        <div className="row">
          <label className="field"><span>С</span><TimeInput step={15} value={start} onChange={(v) => { save.reset(); setStart(v) }} /></label>
          <label className="field"><span>До</span><TimeInput step={15} value={end} onChange={(v) => { save.reset(); setEnd(v) }} /></label>
        </div>
        <div className="field"><span>Рабочие дни</span>
          <div className="weekdays" role="group" aria-label="Рабочие дни клиники">
            {WEEK.map(([code, name, short]) => (
              <button key={code} type="button" className={off[code] ? 'day off' : 'day'} aria-label={name} aria-pressed={days.has(code) && !off[code]}
                disabled={dropOff.isPending} onClick={() => toggle(code)}>{short}</button>
            ))}
          </div>
          {DAYS.filter((code) => off[code]).map((code) => (
            <p key={code} className="hint hours-off">{onWeekday(code)}: {offLabel(off[code]!)} — из «Перерывы и выходные»</p>
          ))}
        </div>
      </fieldset>
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить часы клиники" savedText="Часы клиники сохранены"
        error={dropOff.error?.message ?? (save.error && (save.error.fieldErrors.workEnd ?? save.error.fieldErrors.workDays ?? save.error.message))} />}
    </form>
  )
}
