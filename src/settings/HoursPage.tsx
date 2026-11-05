import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'
import { HoursEditor } from '../team/HoursEditor'
import { WEEK, type Weekday } from '../team/texts'
import { clinicRequest } from './clinicUpdate'
import { SubHeader } from './SubHeader'

type Me = Schemas['BookingViewsMe']
type Clinic = Schemas['ClinicView']

/**
 * «Часы работы» одним экраном: часы клиники (по ним работают врачи без своих часов) и часы
 * каждого врача — раскрыть и поменять. Врач видит свои, админ и регистратура — всех.
 */
export function HoursPage({ me, onBack, title = 'Часы работы', tabs }: { me: Me; onBack: () => void; title?: string; tabs?: React.ReactNode }) {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
    .filter((d) => me.admin || me.reception || d.id === me.doctorId)
  const [open, setOpen] = useState<number | null>(doctors.length === 1 ? doctors[0]!.id! : me.doctorId ?? null)
  return (
    <section className="schedule-main">
      <SubHeader title={title} onBack={onBack}>{tabs}</SubHeader>
      <section className="card-block">
        <h2>Часы клиники</h2>
        {clinic.isPending ? <p className="hint">Загрузка…</p> : clinic.error ? <p className="error">{clinic.error.message}</p>
          : <ClinicHours clinic={clinic.data} canEdit={Boolean(me.admin || me.doctorId != null)} />}
      </section>
      <section className="card-block">
        <h2>Часы врачей</h2>
        <p className="hint">У каждого врача свои дни и часы: по ним свободное время в боте и в «Новой записи». Не задал — работает по часам клиники. Обед и намаз — в «Перерывах и выходных».</p>
        {doctors.map((d) => (
          <div key={d.id} className="hours-doctor">
            <button type="button" className="hours-toggle" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id!)}>
              <strong>{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</strong><span aria-hidden="true">{open === d.id ? '▴' : '▾'}</span>
            </button>
            {open === d.id && <HoursEditor doctorId={d.id!} />}
          </div>
        ))}
      </section>
    </section>
  )
}

function ClinicHours({ clinic: c, canEdit }: { clinic: Clinic; canEdit: boolean }) {
  const client = useQueryClient()
  const [start, setStart] = useState((c.workStart ?? '09:00').slice(0, 5))
  const [end, setEnd] = useState((c.workEnd ?? '18:00').slice(0, 5))
  const [days, setDays] = useState<Set<Weekday>>(new Set(c.workDays ?? WEEK.map(([code]) => code)))
  const { dirty, commit } = useDirty({ start, end, days: WEEK.map(([code]) => code).filter((code) => days.has(code)) })
  const save = useMutation<Clinic, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic', {
      body: clinicRequest(c, { workStart: start, workEnd: end, workDays: WEEK.map(([code]) => code).filter((code) => days.has(code)) }),
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['clinic'], saved)
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const toggle = (code: Weekday) => {
    save.reset()
    const next = new Set(days)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDays(next)
  }
  return (
    <form className="form" aria-label="Часы клиники" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <fieldset className="form" disabled={!canEdit}>
        <div className="row">
          <label className="field"><span>С</span><input type="time" step={900} value={start} onChange={(e) => { save.reset(); setStart(e.target.value) }} /></label>
          <label className="field"><span>До</span><input type="time" step={900} value={end} onChange={(e) => { save.reset(); setEnd(e.target.value) }} /></label>
        </div>
        <div className="field"><span>Рабочие дни</span>
          <div className="weekdays" role="group" aria-label="Рабочие дни клиники">
            {WEEK.map(([code, name, short]) => (
              <button key={code} type="button" className="day" aria-label={name} aria-pressed={days.has(code)} onClick={() => toggle(code)}>{short}</button>
            ))}
          </div>
        </div>
      </fieldset>
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить часы клиники" savedText="Часы клиники сохранены"
        error={save.error && (save.error.fieldErrors.workEnd ?? save.error.fieldErrors.workDays ?? save.error.message)} />}
    </form>
  )
}
