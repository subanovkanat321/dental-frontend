import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { TIME_OFF_EMOJI, timeOffWhen, WEEK, type Weekday } from './texts'
import { isAssistant } from '../lib/roles'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Me = Schemas['BookingViewsMe']

/**
 * «Перерывы»: джума-намаз, обед, отпуск — в это время пациенты не запишутся через бота (сами
 * сотрудники записать могут). Каждую неделю или по датам; весь день или с–по. Общий перерыв (для
 * всех врачей) ставит и удаляет админ; свой — врач, регистратура — любому врачу.
 */
export function TimeOffTab({ me }: { me: Me }) {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['time-off'], queryFn: () => unwrap(api.GET('/api/time-off')) })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const nameOf = (id?: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? 'врач скрыт'
  const canDelete = (t: Schemas['TimeOffView']) => Boolean(me.admin || (t.doctorId != null && (me.reception || t.doctorId === me.doctorId)))
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/time-off/{id}', { params: { path: { id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['time-off'] }),
  })

  return (
    <>
      <section className="card-block">
        <p className="hint">В это время пациенты не смогут записаться через бота. Вы сами записать можете.</p>
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <Loading /> : list.data?.length ? (
          <table className="table" aria-label="Перерывы">
            <thead><tr><th>Перерыв</th><th>Когда</th>{doctors.length > 1 && <th>Для кого</th>}<th /></tr></thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id}>
                  <td><span aria-hidden="true">{t.emoji}</span> <span className="strong">{t.title}</span></td>
                  <td className="nowrap">{timeOffWhen(t)}</td>
                  {doctors.length > 1 && <td>{t.doctorId ? nameOf(t.doctorId) : 'Все врачи'}</td>}
                  <td className="r">{canDelete(t) && (
                    <button type="button" className="btn small ghost" aria-label={`Удалить: ${t.title}`} disabled={remove.isPending}
                      onClick={() => void ask(`Удалить перерыв «${t.title}»?`).then((ok) => ok && remove.mutate(t.id!))}>Удалить</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title="Перерывов нет" />}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      </section>
      {/* Ассистент только смотрит: перерывы и выходные ставят врач, регистратура и админ */}
      {isAssistant(me) ? <p className="hint">Перерывы и выходные ставят врач, регистратура или администратор.</p> : <NewTimeOff me={me} />}
    </>
  )
}

const FIELDS = ['title', 'firstDay', 'lastDay', 'endTime', 'emoji'] as const

function NewTimeOff({ me }: { me: Me }) {
  const client = useQueryClient()
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // Для кого: врач — себе; регистратура — любому врачу; админ ещё и всем сразу (null)
  const choices: [number | null, string][] = [...(me.admin ? [[null, 'Все врачи'] as [null, string]] : []),
    ...(me.admin || me.reception ? doctors.map((d) => [d.id!, d.fullName ?? ''] as [number, string]) : [])]
  const initialWho = me.reception ? doctors[0]?.id ?? null : !me.admin ? me.doctorId ?? null
    : doctors.length > 1 ? me.doctorId ?? doctors[0]?.id ?? null : null
  const [who, setWho] = useState<number | null>(initialWho)
  const [weekly, setWeekly] = useState(true)
  const [weekday, setWeekday] = useState<Weekday>('FRIDAY')
  const [firstDay, setFirstDay] = useState(todayIn())
  const [lastDay, setLastDay] = useState(todayIn())
  const [wholeDay, setWholeDay] = useState(false)
  const [startTime, setStartTime] = useState('13:00')
  const [endTime, setEndTime] = useState('14:00')
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState(TIME_OFF_EMOJI[0]!)
  const save = useMutation<Schemas['TimeOffView'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/time-off', {
      body: {
        doctorId: who ?? undefined,
        weekday: weekly ? weekday : undefined,
        firstDay: weekly ? undefined : firstDay,
        lastDay: weekly ? undefined : lastDay,
        startTime: wholeDay ? undefined : startTime,
        endTime: wholeDay ? undefined : endTime,
        title,
        emoji,
      },
    })),
    onSuccess: () => {
      setTitle('')
      void client.invalidateQueries({ queryKey: ['time-off'] })
    },
  })
  const fieldError = (key: string) => save.error?.fieldErrors[key]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <section className="card-block">
      <h2>Новый перерыв</h2>
      <form className="form narrow" aria-label="Новый перерыв" onSubmit={submit}>
        {choices.length > 1 && (
          <label className="field"><span>Для кого</span>
            <Select value={who ?? ''} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : null)}>
              {choices.map(([id, name]) => <option key={id ?? 'all'} value={id ?? ''}>{name}</option>)}
            </Select>
          </label>
        )}
        <div className="segments" role="group" aria-label="Повтор">
          <button type="button" aria-pressed={weekly} onClick={() => setWeekly(true)}>Каждую неделю</button>
          <button type="button" aria-pressed={!weekly} onClick={() => setWeekly(false)}>По датам</button>
        </div>
        {weekly ? (
          <div className="field"><span>День недели</span>
            <div className="weekdays" role="group" aria-label="День недели">
              {WEEK.map(([code, name, short]) => (
                <button key={code} type="button" className="day" aria-label={name} aria-pressed={weekday === code} onClick={() => setWeekday(code)}>{short}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="row">
            <label className="field"><span>С даты</span>
              <DateInput weekday value={firstDay} required onChange={(e) => { setFirstDay(e.target.value); if (lastDay < e.target.value) setLastDay(e.target.value) }} />
            </label>
            <label className="field"><span>По дату (включительно)</span>
              <DateInput weekday value={lastDay} min={firstDay} required onChange={(e) => setLastDay(e.target.value)} />
            </label>
          </div>
        )}
        {(fieldError('firstDay') || fieldError('lastDay')) && <p className="error">{fieldError('firstDay') ?? fieldError('lastDay')}</p>}
        <label className="check"><input type="checkbox" checked={wholeDay} onChange={(e) => setWholeDay(e.target.checked)} /> Весь день (выходной, отпуск)</label>
        {!wholeDay && (
          <div className="row">
            <label className="field"><span>С</span><input type="time" step={900} value={startTime} required onChange={(e) => setStartTime(e.target.value)} /></label>
            <label className="field"><span>До</span><input type="time" step={900} value={endTime} required onChange={(e) => setEndTime(e.target.value)} /></label>
          </div>
        )}
        {fieldError('endTime') && <p className="error">{fieldError('endTime')}</p>}
        <label className="field"><span>Название</span>
          <input value={title} required maxLength={60} placeholder="Например: Обед" onChange={(e) => setTitle(e.target.value)} />
        </label>
        {fieldError('title') && <p className="error">{fieldError('title')}</p>}
        <div className="field"><span>Значок — пациенты видят его в боте</span>
          <div className="weekdays" role="group" aria-label="Значок">
            {TIME_OFF_EMOJI.map((e) => <button key={e} type="button" className="day" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
        </div>
        {save.error && !FIELDS.some((k) => fieldError(k)) && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
        {save.isSuccess && <p className="tone-ok" role="status">Перерыв добавлен</p>}
        <button type="submit" className="btn primary" disabled={save.isPending}>Добавить перерыв</button>
      </form>
    </section>
  )
}
