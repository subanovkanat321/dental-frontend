import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { isAssistant } from '../lib/roles'
import { Loading } from '../layout/Loading'
import './timeoff.css'
import { NewBreak, NewDayOff, NewLeave } from './TimeOffForms'
import { groupOf, rowsOf, type Group, type Row } from './timeOffTexts'
import type { Weekday } from './texts'
import { DAYS } from './dayOffHours'

type Me = Schemas['BookingViewsMe']

const ACTIONS: [Group, string][] = [['break', '＋ Перерыв'], ['dayOff', '＋ Выходной день'], ['leave', '＋ Отпуск / больничный']]
const SECTIONS: [Group, string, string][] = [
  ['break', 'Перерывы', 'Перерывов нет'],
  ['dayOff', 'Выходные дни', 'Выходных нет'],
  ['leave', 'Отпуска и больничные', 'Отпусков нет'],
]

/**
 * «Перерывы и выходные»: в это время пациенты не запишутся через бота (сами сотрудники записать
 * могут). Три действия вместо одной формы с галочкой «весь день»: перерыв (в течение дня, каждую
 * неделю), выходной день (весь день — каждую неделю или по датам) и отпуск / больничный (период).
 * Общий (для всех врачей) ставит и удаляет админ; свой — врач, регистратура — любому врачу.
 */
export function TimeOffTab({ me }: { me: Me }) {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['time-off'], queryFn: () => unwrap(api.GET('/api/time-off')) })
  const [form, setForm] = useState<Group | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const nameOf = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? 'врач скрыт'
  const canDelete = (t: Schemas['TimeOffView']) => Boolean(me.admin || (t.doctorId != null && (me.reception || t.doctorId === me.doctorId)))
  const remove = useMutation<unknown, ApiError, number[]>({
    mutationFn: async (ids) => {
      for (const id of ids) await unwrap(api.DELETE('/api/time-off/{id}', { params: { path: { id } } }))
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['time-off'] }),
  })
  const open = (g: Group) => { setForm(form === g ? null : g); setDone(null) }
  const finish = (message: string) => { setForm(null); setDone(message) }
  const close = () => setForm(null)
  const editor = !isAssistant(me)

  const line = (r: Row) => {
    const t = r.first
    const label = `${t.emoji ?? ''} ${t.title ?? ''}`.trim()
    return (
      <li key={r.ids.join()}>
        <div className="timeoff-text">
          {/* Переносим между кусками, а не внутри «12:00–14:00» или названия */}
          <span>{r.when.split(', ').map((part, i, all) => <span key={i}><span className="nowrap">{part}{i < all.length - 1 ? ',' : ''}</span> </span>)}
            <span className="nowrap">— <span className="strong">{label}</span></span></span>
          {doctors.length > 1 && <span className="hint">{t.doctorId ? nameOf(t.doctorId) : 'Все врачи'}</span>}
          {groupOf(t) === 'dayOff' && t.weekday && <InsteadOfHours row={r} />}
        </div>
        {editor && canDelete(t) && (
          <button type="button" className="btn small ghost" aria-label={`Удалить: ${t.title}`} disabled={remove.isPending}
            onClick={() => void ask(`Удалить «${t.title}» (${r.when})?`).then((ok) => ok && remove.mutate(r.ids))}>Удалить</button>
        )}
      </li>
    )
  }

  return (
    <>
      <section className="card-block">
        <p className="hint">В это время пациенты не смогут записаться через бота. Вы сами записать можете.</p>
        {/* Ассистент только смотрит: перерывы и выходные ставят врач, регистратура и админ */}
        {editor ? (
          <div className="timeoff-actions" role="group" aria-label="Добавить">
            {ACTIONS.map(([g, name]) => (
              <button key={g} type="button" className={form === g ? 'btn primary' : 'btn'} aria-pressed={form === g} onClick={() => open(g)}>{name}</button>
            ))}
          </div>
        ) : <p className="hint">Перерывы и выходные ставят врач, регистратура или администратор.</p>}
        {done && <p className="tone-ok" role="status">{done}</p>}
      </section>
      {form === 'break' && <NewBreak me={me} onDone={finish} onCancel={close} />}
      {form === 'dayOff' && <NewDayOff me={me} onDone={finish} onCancel={close} />}
      {form === 'leave' && <NewLeave me={me} onDone={finish} onCancel={close} />}
      <section className="card-block">
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <Loading /> : SECTIONS.map(([g, title, empty]) => {
          const rows = rowsOf((list.data ?? []).filter((t) => groupOf(t) === g))
          return (
            <div key={g} className="timeoff-group">
              <h2>{title}</h2>
              {rows.length ? <ul className="timeoff-list" aria-label={title}>{rows.map(line)}</ul> : <p className="hint">{empty}</p>}
            </div>
          )
        })}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      </section>
    </>
  )
}

/**
 * Еженедельный выходной на рабочий по часам день — это нормально (выходной перекрывает часы), но
 * пусть будет видно, что он закрывает: «вместо рабочих часов 09:00–18:00». Часы — врача, у «Все
 * врачи» — клиники; у дней одной строки они разные или день и так нерабочий — не пишем.
 */
function InsteadOfHours({ row }: { row: Row }) {
  const doctorId = row.first.doctorId ?? null
  const hours = useQuery({
    queryKey: ['doctor-hours', doctorId], enabled: doctorId != null,
    queryFn: () => unwrap(api.GET('/api/doctors/{id}/hours', { params: { path: { id: doctorId! } } })),
  })
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: doctorId == null })
  const byDay = new Map<Weekday, string>()
  const hm = (start?: string, end?: string) => `${(start ?? '').slice(0, 5)}–${(end ?? '').slice(0, 5)}`
  if (doctorId != null) for (const d of hours.data?.days ?? []) byDay.set(d.weekday!, hm(d.start, d.end))
  else if (clinic.data) {
    for (const d of clinic.data.workDays ?? DAYS) {
      byDay.set(d, hm(clinic.data.workStart ?? '09:00', clinic.data.workEnd ?? '18:00'))
    }
  }
  const shown = [...new Set(row.weekdays.map((d) => byDay.get(d)).filter(Boolean))]
  if (shown.length !== 1) return null
  return <span className="hint">вместо рабочих часов <span className="nowrap">{shown[0]}</span></span>
}
