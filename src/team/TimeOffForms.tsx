import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { WEEK, type Weekday } from './texts'
import { BREAK_KINDS, DAY_OFF_KINDS, LEAVE_KINDS, OTHER, titleFor, toRanges, type Kind } from './timeOffTexts'

type Me = Schemas['BookingViewsMe']
type Body = Schemas['TimeOffControllerRequest']

/** Что показать после сохранения и закрыть форму. */
type Done = (message: string) => void

/**
 * Сохранить несколько записей подряд: «обед пн–пт» — пять еженедельных записей (у API один день недели
 * на запись), праздник на несколько дат — по записи на каждый период. Сервер отдельной «пачки» не
 * знает: упадёт на третьей — первые две останутся, список всё равно обновим.
 */
function useCreate(onSaved: (count: number) => void) {
  const client = useQueryClient()
  return useMutation<number, ApiError, Body[]>({
    mutationFn: async (bodies) => {
      for (const body of bodies) await unwrap(api.POST('/api/time-off', { body }))
      return bodies.length
    },
    onSuccess: onSaved,
    onSettled: () => client.invalidateQueries({ queryKey: ['time-off'] }),
  })
}

/** Для кого: врач — себе; регистратура — любому врачу; админ ещё и всем сразу (null). */
function useWho(me: Me) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const choices: [number | null, string][] = [...(me.admin ? [[null, 'Все врачи'] as [null, string]] : []),
    ...(me.admin || me.reception ? doctors.map((d) => [d.id!, d.fullName ?? ''] as [number, string]) : [])]
  const initial = me.reception ? doctors[0]?.id ?? null : !me.admin ? me.doctorId ?? null
    : doctors.length > 1 ? me.doctorId ?? doctors[0]?.id ?? null : null
  const [who, setWho] = useState<number | null>(initial)
  const field = choices.length > 1 && (
    <label className="field"><span>Для кого</span>
      <Select value={who ?? ''} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : null)}>
        {choices.map(([id, name]) => <option key={id ?? 'all'} value={id ?? ''}>{name}</option>)}
      </Select>
    </label>
  )
  return { doctorId: who ?? undefined, field }
}

/** Тип чипами (🍽️ Обед, 🕌 Намаз…): задаёт название и значок. */
function KindChips({ label, kinds, kind, onKind }: { label: string; kinds: Kind[]; kind: Kind; onKind: (k: Kind) => void }) {
  return (
    <div className="field"><span>{label}</span>
      <div className="chips-pick" role="group" aria-label={label}>
        {kinds.map((k) => (
          <button key={k.title} type="button" className="chip" aria-pressed={k.title === kind.title} onClick={() => onKind(k)}>
            <span aria-hidden="true">{k.emoji}</span> {k.title}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Своё название — необязательно: пусто — название типа (у «Другое» — запасное). */
function TitleField({ kind, own, onOwn, fallback }: { kind: Kind; own: string; onOwn: (v: string) => void; fallback: string }) {
  const other = kind.title === OTHER
  return (
    <>
      <label className="field"><span>{other ? 'Своё название' : 'Название — можно не менять'}</span>
        <input value={own} maxLength={60} placeholder={other ? fallback : kind.title} onChange={(e) => onOwn(e.target.value)} />
      </label>
      <p className="hint">Пациенты видят в боте: {kind.emoji} {titleFor(kind, own, fallback)}</p>
    </>
  )
}

/** Дни недели — можно несколько. */
function Weekdays({ value, onChange }: { value: Weekday[]; onChange: (days: Weekday[]) => void }) {
  return (
    <div className="field"><span>Дни недели</span>
      <div className="weekdays" role="group" aria-label="Дни недели">
        {WEEK.map(([code, name, short]) => (
          <button key={code} type="button" className="day" aria-label={name} aria-pressed={value.includes(code)}
            onClick={() => onChange(value.includes(code) ? value.filter((d) => d !== code) : [...value, code])}>{short}</button>
        ))}
      </div>
    </div>
  )
}

function FormCard({ title, onSubmit, onCancel, error, pending, submit, children }: {
  title: string; onSubmit: () => void; onCancel: () => void; error: string | null; pending: boolean; submit: string; children: ReactNode
}) {
  return (
    <section className="card-block timeoff-form">
      <h2>{title}</h2>
      <form className="form narrow" aria-label={title} onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit() }}>
        {children}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={pending}>{submit}</button>
          <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
        </div>
      </form>
    </section>
  )
}

const errorText = (e: ApiError | null) => (e ? Object.values(e.fieldErrors)[0] ?? e.message : null)

/** «＋ Перерыв»: каждую неделю в выбранные дни с–до — обед, намаз, кофе. */
export function NewBreak({ me, onDone, onCancel }: { me: Me; onDone: Done; onCancel: () => void }) {
  const who = useWho(me)
  const [kind, setKind] = useState(BREAK_KINDS[0]!)
  const [own, setOwn] = useState('')
  const [days, setDays] = useState<Weekday[]>(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'])
  const [startTime, setStartTime] = useState('13:00')
  const [endTime, setEndTime] = useState('14:00')
  const [error, setError] = useState<string | null>(null)
  const save = useCreate((n) => onDone(n > 1 ? `Перерыв добавлен на ${n} дн.` : 'Перерыв добавлен'))
  const submit = () => {
    if (!days.length) return setError('Выберите хотя бы один день')
    if (endTime <= startTime) return setError('Конец — позже начала')
    setError(null)
    const title = titleFor(kind, own, 'Перерыв')
    save.mutate(days.map((weekday) => ({ doctorId: who.doctorId, weekday, startTime, endTime, title, emoji: kind.emoji })))
  }
  return (
    <FormCard title="Новый перерыв" submit="Добавить перерыв" onSubmit={submit} onCancel={onCancel}
      error={error ?? errorText(save.error)} pending={save.isPending}>
      {who.field}
      <KindChips label="Какой перерыв" kinds={BREAK_KINDS} kind={kind} onKind={setKind} />
      <Weekdays value={days} onChange={setDays} />
      <div className="row">
        <label className="field"><span>С</span><input type="time" step={900} value={startTime} required onChange={(e) => setStartTime(e.target.value)} /></label>
        <label className="field"><span>До</span><input type="time" step={900} value={endTime} required onChange={(e) => setEndTime(e.target.value)} /></label>
      </div>
      <TitleField kind={kind} own={own} onOwn={setOwn} fallback="Перерыв" />
    </FormCard>
  )
}

/** «＋ Выходной день»: весь день — каждую неделю (каждое воскресенье) или в выбранные даты (праздник). */
export function NewDayOff({ me, onDone, onCancel }: { me: Me; onDone: Done; onCancel: () => void }) {
  const who = useWho(me)
  const [weekly, setWeekly] = useState(true)
  const [days, setDays] = useState<Weekday[]>(['SUNDAY'])
  const [dates, setDates] = useState<string[]>([todayIn()])
  const [kind, setKind] = useState(DAY_OFF_KINDS[0]!)
  const [own, setOwn] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useCreate(() => onDone('Выходной добавлен'))
  const submit = () => {
    const title = titleFor(kind, own, 'Выходной')
    const base = { doctorId: who.doctorId, title, emoji: kind.emoji }
    const bodies: Body[] = weekly ? days.map((weekday) => ({ ...base, weekday }))
      : toRanges(dates).map(([firstDay, lastDay]) => ({ ...base, firstDay, lastDay }))
    if (!bodies.length) return setError(weekly ? 'Выберите хотя бы один день' : 'Выберите дату')
    setError(null)
    save.mutate(bodies)
  }
  return (
    <FormCard title="Новый выходной день" submit="Добавить выходной" onSubmit={submit} onCancel={onCancel}
      error={error ?? errorText(save.error)} pending={save.isPending}>
      {who.field}
      <div className="segments" role="group" aria-label="Когда">
        <button type="button" aria-pressed={weekly} onClick={() => setWeekly(true)}>Каждую неделю</button>
        <button type="button" aria-pressed={!weekly} onClick={() => { setWeekly(false); if (kind === DAY_OFF_KINDS[0]) setKind(DAY_OFF_KINDS[1]!) }}>Одна дата / праздник</button>
      </div>
      {weekly ? <Weekdays value={days} onChange={setDays} /> : (
        <div className="field"><span>Даты — весь день</span>
          <ul className="timeoff-dates">
            {dates.map((d, i) => (
              <li key={i}>
                <DateInput weekday value={d} aria-label={`Дата ${i + 1}`} onChange={(e) => setDates(dates.map((x, j) => (j === i ? e.target.value : x)))} />
                {dates.length > 1 && (
                  <button type="button" className="btn small ghost" aria-label={`Убрать дату ${i + 1}`} onClick={() => setDates(dates.filter((_, j) => j !== i))}>✕</button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn small" onClick={() => setDates([...dates, addDays(dates.at(-1) ?? todayIn(), 1)])}>＋ Ещё дата</button>
        </div>
      )}
      <KindChips label="Что за день" kinds={DAY_OFF_KINDS} kind={kind} onKind={setKind} />
      <TitleField kind={kind} own={own} onOwn={setOwn} fallback="Выходной" />
    </FormCard>
  )
}

/** «＋ Отпуск / больничный»: период дат с–по, весь день. */
export function NewLeave({ me, onDone, onCancel }: { me: Me; onDone: Done; onCancel: () => void }) {
  const who = useWho(me)
  const [firstDay, setFirstDay] = useState(todayIn())
  const [lastDay, setLastDay] = useState(todayIn())
  const [kind, setKind] = useState(LEAVE_KINDS[0]!)
  const [own, setOwn] = useState('')
  const save = useCreate(() => onDone(`${titleFor(kind, own, 'Отпуск')} — добавлено`))
  const submit = () => save.mutate([{ doctorId: who.doctorId, firstDay, lastDay, title: titleFor(kind, own, 'Отпуск'), emoji: kind.emoji }])
  return (
    <FormCard title="Отпуск или больничный" submit="Добавить" onSubmit={submit} onCancel={onCancel}
      error={errorText(save.error)} pending={save.isPending}>
      {who.field}
      <KindChips label="Что это" kinds={LEAVE_KINDS} kind={kind} onKind={setKind} />
      <div className="row timeoff-period">
        <label className="field"><span>С даты</span>
          <DateInput weekday value={firstDay} required onChange={(e) => { setFirstDay(e.target.value); if (lastDay < e.target.value) setLastDay(e.target.value) }} />
        </label>
        <label className="field"><span>По дату (включительно)</span>
          <DateInput weekday value={lastDay} min={firstDay} required onChange={(e) => setLastDay(e.target.value)} />
        </label>
      </div>
      <TitleField kind={kind} own={own} onOwn={setOwn} fallback="Отпуск" />
    </FormCard>
  )
}
