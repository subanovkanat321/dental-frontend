import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { weekLabel } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { TimeInput } from '../layout/TimeInput'
import { Select } from '../layout/Select'
import { dayLong, hm, SHIFT_ROLE, type Shift } from './workWeek'
import { BREAK_KINDS, DAY_OFF_KINDS, LEAVE_KINDS, OTHER, titleFor, type Kind } from './timeOffTexts'

type Person = Schemas['ShiftServicePerson']

/** Смена сотрудника на дату: новая (день и человек — из нажатой ячейки) или поставленная. */
export type Editing = { shift?: Shift; telegramId: number; day: string }

/** Добавить или изменить смену: кто, день, с–до, пометка. Изменить — ещё и «Удалить». */
export function ShiftForm({ editing, people, onDone }: { editing: Editing; people: Person[]; onDone: () => void }) {
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
          <label className="field"><span>С</span><TimeInput step={15} value={startTime} required onChange={setStartTime} /></label>
          <label className="field"><span>До</span><TimeInput step={15} value={endTime} required onChange={setEndTime} /></label>
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
              onClick={() => void ask('Удалить эту смену?').then((ok) => ok && remove.mutate())}>Удалить</button>
          )}
        </div>
      </form>
    </section>
  )
}

/** «Повторить эту неделю на N недель»: занятое уже не трогает — сервер пропускает пересечения. */
export function CopyWeek({ monday }: { monday: string }) {
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
          onClick={() => void ask(`Повторить смены недели ${weekLabel(monday)} на ${weeksText(weeks)} вперёд?`).then((ok) => ok && copy.mutate())}>
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


type TimeOff = Schemas['TimeOffView']

/** Исключение врача на дату: новое (врач и день — из нажатой ячейки) или уже стоящее. */
export type DayOffEditing = { doctorId: number; name: string; day: string; entry?: TimeOff }

const WHOLE_DAY_KINDS: Kind[] = [...DAY_OFF_KINDS, ...LEAVE_KINDS]
const PART_KINDS: Kind[] = [{ title: 'Ушёл раньше', emoji: '🚪' }, ...BREAK_KINDS]

/** «12 нояб» или «10–20 нояб» — даты записи «Перерывов и выходных». */
function datesText(t: TimeOff): string {
  const fmt = (d: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`)).replace('.', '')
  const first = t.firstDay ?? ''
  const last = t.lastDay ?? first
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`
}

/**
 * Перерыв или выходной врача на дату (запись «Перерывов и выходных» с firstDay = lastDay): весь день
 * (выходной, праздник, отпуск) или часть дня (с–до). Смен у врача нет: рабочие часы — его неделя
 * («Обычная неделя»), а здесь только «не работает». Уже стоящее — показать и удалить (отпуск на несколько
 * дней удалится целиком: так он и хранится). Права — как в «Перерывах и выходных»: свой — врач,
 * любому врачу — регистратура, общий для всей клиники — руководитель.
 */
export function DayOffForm({ editing, canDelete, onDone, onWeek, onTimeOff }: {
  editing: DayOffEditing; canDelete: boolean; onDone: () => void; onWeek: () => void; onTimeOff: () => void
}) {
  const client = useQueryClient()
  const [whole, setWhole] = useState(true)
  const [kind, setKind] = useState<Kind>(WHOLE_DAY_KINDS[0]!)
  const [own, setOwn] = useState('')
  const [startTime, setStartTime] = useState('15:00')
  const [endTime, setEndTime] = useState('18:00')
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.scrollIntoView?.({ block: 'nearest' }) }, [])
  const done = () => {
    void client.invalidateQueries({ queryKey: ['time-off'] })
    onDone()
  }
  const save = useMutation<TimeOff, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/time-off', {
      body: {
        doctorId: editing.doctorId, firstDay: editing.day, lastDay: editing.day, title: titleFor(kind, own, whole ? 'Выходной' : 'Перерыв'),
        emoji: kind.emoji, ...(whole ? {} : { startTime, endTime }),
      },
    })),
    onSuccess: done,
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/time-off/{id}', { params: { path: { id } } })),
    onSuccess: done,
  })
  const hint = (
    <p className="hint">Рабочие часы врача — в его недельном графике:{' '}
      <button type="button" className="link" onClick={onWeek}>«Обычная неделя» — {editing.name}</button>.</p>
  )
  const t = editing.entry
  if (t) {
    const label = `${t.emoji ?? ''} ${t.title ?? ''}`.trim()
    const range = (t.lastDay ?? t.firstDay) !== t.firstDay
    return (
      <section className="card-block" ref={box} aria-label="Перерыв или выходной на дату">
        <h2>{label}</h2>
        <p>{editing.name} · {datesText(t)}{t.startTime ? `, ${hm(t.startTime)}–${hm(t.endTime)}` : ' · весь день'}
          {t.doctorId == null && <span className="hint"> · вся клиника</span>}</p>
        {!canDelete && (
          <p className="hint">{t.doctorId == null ? 'Выходной всей клиники убирает руководитель' : 'Убрать может сам врач, регистратура или руководитель'} —{' '}
            <button type="button" className="link" onClick={onTimeOff}>«Перерывы и выходные»</button>.</p>
        )}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        <div className="shifts-actions">
          {canDelete && (
            <button type="button" className="btn danger" disabled={remove.isPending}
              onClick={() => void ask(range ? `Удалить «${label}» целиком (${datesText(t)})?` : `Удалить «${label}»?`).then((ok) => ok && remove.mutate(t.id))}>Удалить</button>
          )}
          <button type="button" className="btn ghost" onClick={onDone}>Закрыть</button>
        </div>
        {hint}
      </section>
    )
  }
  const kinds = whole ? WHOLE_DAY_KINDS : PART_KINDS
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!whole && endTime <= startTime) return setError('Конец — позже начала')
    setError(null)
    save.mutate()
  }
  return (
    <section className="card-block" ref={box}>
      <h2>Не работает · {editing.name}</h2>
      <form className="form narrow" aria-label="Перерыв или выходной на дату" onSubmit={submit}>
        <p>{dayLong(editing.day)}</p>
        <div className="segments" role="group" aria-label="Сколько">
          <button type="button" aria-pressed={whole} onClick={() => { setWhole(true); setKind(WHOLE_DAY_KINDS[0]!) }}>Весь день</button>
          <button type="button" aria-pressed={!whole} onClick={() => { setWhole(false); setKind(PART_KINDS[0]!) }}>Часть дня</button>
        </div>
        {!whole && (
          <div className="row">
            <label className="field"><span>С</span><TimeInput step={15} value={startTime} required onChange={setStartTime} /></label>
            <label className="field"><span>До</span><TimeInput step={15} value={endTime} required onChange={setEndTime} /></label>
          </div>
        )}
        <div className="field"><span>Что это</span>
          <div className="chips-pick" role="group" aria-label="Что это">
            {kinds.map((k) => (
              <button key={k.title + k.emoji} type="button" className="chip" aria-pressed={k === kind} onClick={() => setKind(k)}>
                <span aria-hidden="true">{k.emoji}</span> {k.title}
              </button>
            ))}
          </div>
        </div>
        <label className="field"><span>{kind.title === OTHER ? 'Своё название' : 'Название — можно не менять'}</span>
          <input value={own} maxLength={60} placeholder={kind.title === OTHER ? '' : kind.title} onChange={(e) => setOwn(e.target.value)} />
        </label>
        <p className="hint">В это время пациенты не запишутся через бота.</p>
        {(error ?? save.error) && <p className="error" role="alert">{error ?? Object.values(save.error!.fieldErrors)[0] ?? save.error!.message}</p>}
        <div className="shifts-actions">
          <button type="submit" className="btn primary" disabled={save.isPending}>Добавить</button>
          <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
        </div>
      </form>
      {hint}
    </section>
  )
}
