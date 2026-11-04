import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { useMedia } from '../lib/useMedia'
import { addDays, todayIn, weekLabel, weekStart } from '../lib/time'
import { SubHeader } from '../settings/SubHeader'
import './shifts.css'

type Schedule = Schemas['ShiftControllerSchedule']
type Shift = Schemas['ShiftServiceShiftView']
type Person = Schemas['ShiftServicePerson']

/** Роль в строке графика — коротко, как в «Персонале». */
const SHIFT_ROLE: Record<string, string> = { ADMIN: 'администратор', RECEPTION: 'регистратура', ASSISTANT: 'ассистент' }

/** '09:00:00' → '09:00'. */
const hm = (time?: string) => (time ?? '').slice(0, 5)

/** «09:00–15:00». */
const shiftHours = (s: Shift) => `${hm(s.startTime)}–${hm(s.endTime)}`

/** «пн 2» — шапка колонки дня; «Понедельник, 2 июня» — заголовок дня на телефоне. */
const dayShort = (date: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
  .format(new Date(`${date}T00:00:00Z`))
const dayLong = (date: string) => {
  const text = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T00:00:00Z`))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Смены клиники за период — общий запрос графика и «Кто сегодня на смене». */
function useShifts(from: string, to: string) {
  return useQuery({
    queryKey: ['shifts', from, to],
    queryFn: () => unwrap(api.GET('/api/shifts', { params: { query: { from, to } } })),
  })
}

type Editing = { shift?: Shift; telegramId: number; day: string }

/**
 * «Настройки → График смен»: неделя персонала без кресла (админы, регистратура, ассистенты) —
 * кто в какой день и с какого по какое время. Врачей здесь нет: у них «Часы работы». Ставит и
 * меняет админ; остальные видят график только для чтения, своя строка подсвечена. Телефон —
 * список по дням вместо таблицы.
 */
export function ShiftsPage({ onBack }: { onBack: () => void }) {
  const [monday, setMonday] = useState(() => weekStart(todayIn()))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const loaded = useShifts(monday, days[6]!)
  const phone = useMedia('(max-width: 760px)')
  const [editing, setEditing] = useState<Editing | null>(null)
  const data = loaded.data
  const canEdit = Boolean(data?.canEdit)
  const open = canEdit ? (e: Editing) => setEditing(e) : undefined

  return (
    <div className="shifts-page">
      <SubHeader title="График смен" onBack={onBack}>
        <div className="shifts-nav" role="group" aria-label="Неделя">
          <button type="button" className="btn ghost" aria-label="Прошлая неделя" onClick={() => { setMonday(addDays(monday, -7)); setEditing(null) }}>‹</button>
          <strong className="num">{weekLabel(monday)}</strong>
          <button type="button" className="btn ghost" aria-label="Следующая неделя" onClick={() => { setMonday(addDays(monday, 7)); setEditing(null) }}>›</button>
          {monday !== weekStart(todayIn()) && (
            <button type="button" className="btn small" onClick={() => { setMonday(weekStart(todayIn())); setEditing(null) }}>Эта неделя</button>
          )}
        </div>
      </SubHeader>
      <p className="hint">
        {canEdit
          ? 'Смены администраторов, регистратуры и ассистентов. Нажмите на ячейку, чтобы добавить или изменить смену. У врачей — «Часы работы».'
          : 'График смен ведёт администратор клиники. Ваша строка подсвечена.'}
      </p>
      {loaded.error && <p className="error" role="alert">{loaded.error.message}</p>}
      {loaded.isPending ? <p className="hint">Загрузка…</p> : data && (
        (data.people ?? []).length === 0 ? (
          <p className="hint">Смены ставят администраторам без своего кресла, регистратуре и ассистентам — пригласите их в «Персонале».</p>
        ) : phone ? <DayList data={data} days={days} onOpen={open} /> : <WeekTable data={data} days={days} onOpen={open} />
      )}
      {editing && data && (
        <ShiftForm key={`${editing.shift?.id ?? 'new'}-${editing.telegramId}-${editing.day}`} editing={editing} people={data.people ?? []}
          onDone={() => setEditing(null)} />
      )}
      {canEdit && data && (data.shifts ?? []).length > 0 && <CopyWeek monday={monday} />}
    </div>
  )
}

function shiftsOf(data: Schedule, telegramId: number, day: string) {
  return (data.shifts ?? []).filter((s) => s.telegramId === telegramId && s.day === day)
}

function WeekTable({ data, days, onOpen }: { data: Schedule; days: string[]; onOpen?: (e: Editing) => void }) {
  const today = todayIn()
  return (
    <div className="shifts-scroll">
      <table className="table shifts-week" aria-label="График смен на неделю">
        <thead>
          <tr>
            <th>Сотрудник</th>
            {days.map((d) => <th key={d} className={d === today ? 'today' : undefined}>{dayShort(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {(data.people ?? []).map((p) => (
            <tr key={p.telegramId} className={p.telegramId === data.me ? 'mine' : undefined} aria-current={p.telegramId === data.me ? 'true' : undefined}>
              <th scope="row"><PersonName person={p} me={data.me} /></th>
              {days.map((d) => {
                const list = shiftsOf(data, p.telegramId!, d)
                return (
                  <td key={d} className={d === today ? 'today' : undefined}>
                    {list.map((s) => onOpen ? (
                      <button key={s.id} type="button" className="shift-chip num" title={s.note}
                        aria-label={`${p.fullName}, ${dayLong(d)}: ${shiftHours(s)} — изменить`}
                        onClick={() => onOpen({ shift: s, telegramId: p.telegramId!, day: d })}>{shiftHours(s)}</button>
                    ) : (
                      <span key={s.id} className="shift-chip num" title={s.note}>{shiftHours(s)}</span>
                    ))}
                    {onOpen && (
                      <button type="button" className="shift-add" aria-label={`Добавить смену: ${p.fullName}, ${dayLong(d)}`}
                        onClick={() => onOpen({ telegramId: p.telegramId!, day: d })}>+</button>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PersonName({ person, me }: { person: Person; me?: number }) {
  return (
    <span className="shift-person">
      <span className="strong">{person.fullName}{person.telegramId === me ? ' (вы)' : ''}</span>
      <span className="hint small">{SHIFT_ROLE[person.role ?? ''] ?? ''}</span>
    </span>
  )
}

/** Телефон: дни по порядку, в каждом — кто на смене; админу — «+ Смена» в каждом дне. */
function DayList({ data, days, onOpen }: { data: Schedule; days: string[]; onOpen?: (e: Editing) => void }) {
  const people = data.people ?? []
  const nameOf = (id?: number) => people.find((p) => p.telegramId === id)
  return (
    <div className="shifts-days" aria-label="График смен по дням">
      {days.map((d) => {
        const list = (data.shifts ?? []).filter((s) => s.day === d && nameOf(s.telegramId))
        return (
          <section key={d} className="card-block shifts-day" aria-label={dayLong(d)}>
            <h2>{dayLong(d)}{d === todayIn() ? ' · сегодня' : ''}</h2>
            {list.length === 0 && <p className="hint">Смен нет</p>}
            <ul>
              {list.map((s) => {
                const p = nameOf(s.telegramId)!
                const body = (
                  <>
                    <span className="num strong">{shiftHours(s)}</span>
                    <span>{p.fullName}{p.telegramId === data.me ? ' (вы)' : ''} <span className="hint small">· {SHIFT_ROLE[p.role ?? '']}</span></span>
                    {s.note && <span className="hint small">{s.note}</span>}
                  </>
                )
                return (
                  <li key={s.id} className={p.telegramId === data.me ? 'mine' : undefined}>
                    {onOpen ? (
                      <button type="button" className="shift-line" onClick={() => onOpen({ shift: s, telegramId: s.telegramId!, day: d })}>{body}</button>
                    ) : <div className="shift-line">{body}</div>}
                  </li>
                )
              })}
            </ul>
            {onOpen && (
              <button type="button" className="btn small" onClick={() => onOpen({ telegramId: people[0]!.telegramId!, day: d })}>+ Смена</button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Добавить или изменить смену: кто, день, с–до, пометка. Изменить — ещё и «Удалить». */
function ShiftForm({ editing, people, onDone }: { editing: Editing; people: Person[]; onDone: () => void }) {
  const client = useQueryClient()
  const [telegramId, setTelegramId] = useState(editing.telegramId)
  const [day, setDay] = useState(editing.day)
  const [startTime, setStartTime] = useState(hm(editing.shift?.startTime) || '09:00')
  const [endTime, setEndTime] = useState(hm(editing.shift?.endTime) || '15:00')
  const [note, setNote] = useState(editing.shift?.note ?? '')
  const id = editing.shift?.id
  // Форма под графиком: открыли — показать её, не листая вручную
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.scrollIntoView?.({ block: 'nearest' }) }, [])
  const done = () => {
    void client.invalidateQueries({ queryKey: ['shifts'] })
    onDone()
  }
  const save = useMutation<Shift, ApiError>({
    mutationFn: () => {
      const body = { telegramId, day, startTime, endTime, note: note.trim() || undefined }
      return unwrap(id != null
        ? api.PUT('/api/shifts/{id}', { params: { path: { id } }, body })
        : api.POST('/api/shifts', { body }))
    },
    onSuccess: done,
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/shifts/{id}', { params: { path: { id: id! } } })),
    onSuccess: done,
  })
  const err = save.error?.fieldErrors ?? {}
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <section className="card-block" ref={box}>
      <h2>{id != null ? 'Изменить смену' : 'Новая смена'}</h2>
      <form className="form narrow" aria-label={id != null ? 'Изменить смену' : 'Новая смена'} onSubmit={submit}>
        <label className="field"><span>Сотрудник</span>
          <Select value={telegramId} onChange={(e) => setTelegramId(Number(e.target.value))}>
            {people.map((p) => <option key={p.telegramId} value={p.telegramId}>{`${p.fullName} · ${SHIFT_ROLE[p.role ?? ''] ?? ''}`}</option>)}
          </Select>
        </label>
        {err.telegramId && <p className="error">{err.telegramId}</p>}
        <label className="field"><span>День</span>
          <DateInput weekday value={day} required onChange={(e) => setDay(e.target.value)} />
        </label>
        <div className="row">
          <label className="field"><span>С</span><input type="time" step={900} value={startTime} required onChange={(e) => setStartTime(e.target.value)} /></label>
          <label className="field"><span>До</span><input type="time" step={900} value={endTime} required onChange={(e) => setEndTime(e.target.value)} /></label>
        </div>
        {(err.startTime || err.endTime || err.day) && <p className="error" role="alert">{err.startTime ?? err.endTime ?? err.day}</p>}
        <label className="field"><span>Пометка (необязательно)</span>
          <input value={note} maxLength={60} placeholder="Например: за Бермет" onChange={(e) => setNote(e.target.value)} />
        </label>
        {err.note && <p className="error">{err.note}</p>}
        {save.error && Object.keys(err).length === 0 && <p className="error" role="alert">{save.error.message}</p>}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        <div className="shifts-actions">
          <button type="submit" className="btn primary" disabled={save.isPending}>{id != null ? 'Сохранить смену' : 'Добавить смену'}</button>
          <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
          {id != null && (
            <button type="button" className="btn danger" disabled={remove.isPending}
              onClick={() => window.confirm('Удалить эту смену?') && remove.mutate()}>Удалить</button>
          )}
        </div>
      </form>
    </section>
  )
}

/** «Повторить эту неделю на N недель»: занятое уже не трогает — сервер пропускает пересечения. */
function CopyWeek({ monday }: { monday: string }) {
  const client = useQueryClient()
  const [weeks, setWeeks] = useState(4)
  const copy = useMutation<Schemas['ShiftServiceCopyResult'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/shifts/copy-week', { body: { weekStart: monday, weeks } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['shifts'] }),
  })
  return (
    <section className="card-block">
      <h2>Повторить неделю</h2>
      <p className="hint">Смены этой недели встанут на те же дни следующих недель. Где у сотрудника уже есть смена в это время — её не трогаем.</p>
      <div className="shifts-actions shifts-copy">
        <label className="field"><span>На сколько недель</span>
          <Select value={weeks} onChange={(e) => { copy.reset(); setWeeks(Number(e.target.value)) }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{weeksText(n)}</option>)}
          </Select>
        </label>
        <button type="button" className="btn" disabled={copy.isPending}
          onClick={() => window.confirm(`Повторить смены недели ${weekLabel(monday)} на ${weeksText(weeks)} вперёд?`) && copy.mutate()}>
          Повторить эту неделю на {weeksText(weeks)}
        </button>
      </div>
      {copy.error && <p className="error" role="alert">{Object.values(copy.error.fieldErrors)[0] ?? copy.error.message}</p>}
      {copy.data && (
        <p className="tone-ok" role="status">
          Добавлено смен: {copy.data.created}{copy.data.skipped ? ` · пропущено (уже занято): ${copy.data.skipped}` : ''}
        </p>
      )}
    </section>
  )
}

function weeksText(n: number): string {
  const last = n % 10
  const word = n % 100 >= 11 && n % 100 <= 14 ? 'недель' : last === 1 ? 'неделю' : last >= 2 && last <= 4 ? 'недели' : 'недель'
  return `${n} ${word}`
}
