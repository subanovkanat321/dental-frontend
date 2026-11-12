import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { somText } from '../lib/time'
import { daysText } from './daysText'

type Sheet = Schemas['TimesheetControllerView']
type Day = Schemas['TimesheetsDay']
type Mark = NonNullable<Day['mark']>
/** Кисть: отметка, которую ставит нажатие на день; 'auto' — убрать отметку, день снова по графику. */
type Brush = Mark | 'auto'

const MARKS: Record<Mark, { icon: string; label: string }> = {
  WORKED: { icon: '✓', label: 'Отработан' },
  OFF: { icon: 'В', label: 'Выходной' },
  SICK: { icon: 'Б', label: 'Больничный' },
  VACATION: { icon: 'О', label: 'Отпуск' },
}

const BRUSHES: [Brush, string][] = [['WORKED', '✓ Отработан'], ['OFF', 'Выходной'], ['SICK', 'Больничный'], ['VACATION', 'Отпуск'], ['auto', 'По графику']]

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Чей табель: врач (doctorId) или сотрудник (telegramId). */
export type Whose = { doctorId?: number; telegramId?: number }

/**
 * Табель месяца (V182 бэкенда): сетка дней с отметками. Без ручной отметки день считается по графику
 * (часы врача или смены сотрудника): прошедший рабочий — ✓, перерыв на весь день из «Перерывов и
 * выходных» — выходной или отпуск. Админ выбирает «кисть» (✓, выходной, больничный, отпуск, «по
 * графику») и нажимает на дни — за прошлые тоже; норму можно задать вручную. Врач видит свой табель
 * без правок. Считает сервер: начислено = оклад × отработано / норма.
 */
export function Timesheet({ whose, month, name, canEdit, onChanged, showSum = true }: {
  whose: Whose
  month: string
  name: string
  canEdit: boolean
  onChanged?: () => void
  /** Итог строкой над сеткой; карточка зарплаты показывает его сама — там false */
  showSum?: boolean
}) {
  const client = useQueryClient()
  const key = ['timesheet', month, whose.doctorId ?? null, whose.telegramId ?? null]
  const sheet = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/api/salaries/timesheet', { params: { query: { month, ...whose } } })),
  })
  const [brush, setBrush] = useState<Brush>('SICK')
  const done = (data: Sheet) => {
    client.setQueryData(key, data)
    onChanged?.()
  }
  const mark = useMutation<Sheet, ApiError, string>({
    mutationFn: (date) => unwrap(api.PUT('/api/salaries/timesheet/day', { body: { ...whose, date, mark: brush === 'auto' ? undefined : brush } })),
    onSuccess: done,
  })
  if (sheet.isPending) return <p className="hint">Загружаем табель…</p>
  if (sheet.error) return <p className="error">{sheet.error.message}</p>
  const s = sheet.data
  const days = s.days ?? []
  const first = days[0]?.date ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  return (
    <section className="timesheet" aria-label={`Табель: ${name}`}>
      {showSum && <p className="timesheet-sum" aria-label="Итог табеля">
        Отработано <b className="num">{s.workedDays}</b> из <b className="num">{s.normDays}</b> {daysText(s.normDays)}
        {s.normManual ? ' (норма вручную)' : ' по графику'}
        {s.baseSom > 0 && <> → <b className="num">{somText(s.accruedSom)}</b> из оклада {somText(s.baseSom)}</>}
      </p>}
      {canEdit && (
        <div className="day-quick wrap" role="group" aria-label="Что ставить">
          {BRUSHES.map(([b, label]) => (
            <button key={b} type="button" className="chip" aria-pressed={brush === b} onClick={() => setBrush(b)}>{label}</button>
          ))}
        </div>
      )}
      <div className="timesheet-grid" role="grid" aria-label="Дни месяца">
        {WEEK.map((w) => <span key={w} className="timesheet-week" role="columnheader">{w}</span>)}
        {Array.from({ length: first }, (_, i) => <span key={`pad${i}`} aria-hidden="true" />)}
        {days.map((d) => <DayCell key={d.date} day={d} canEdit={canEdit} busy={mark.isPending} onPick={() => mark.mutate(d.date!)} />)}
      </div>
      <p className="hint small">
        ✓ — отработан, В — выходной, Б — больничный, О — отпуск; бледные — нерабочие по графику; точка — отметили вручную.
        Больничный и отпуск оплачиваются отдельно — из оклада по табелю они не начисляются.
      </p>
      {mark.error && <p className="error" role="alert">{Object.values(mark.error.fieldErrors)[0] ?? mark.error.message}</p>}
      {canEdit && <NormForm sheet={s} whose={whose} month={month} onDone={done} />}
    </section>
  )
}

function DayCell({ day: d, canEdit, busy, onPick }: { day: Day; canEdit: boolean; busy: boolean; onPick: () => void }) {
  const n = Number(d.date!.slice(8))
  const m = d.mark ? MARKS[d.mark] : null
  const label = `${n}: ${m ? m.label : d.planned ? 'рабочий, ещё не отработан' : 'нерабочий'}${d.manual ? ' (вручную)' : ''}${d.note ? ` — ${d.note}` : ''}`
  const cls = `timesheet-day${d.planned ? '' : ' off'}${d.mark ? ` m-${d.mark.toLowerCase()}` : ''}${d.manual ? ' manual' : ''}`
  const body = <><span className="num">{n}</span><b aria-hidden="true">{m ? m.icon : '·'}</b></>
  return canEdit
    ? <button type="button" role="gridcell" className={cls} aria-label={label} title={label} disabled={busy} onClick={onPick}>{body}</button>
    : <span role="gridcell" className={cls} aria-label={label} title={label}>{body}</span>
}

function NormForm({ sheet: s, whose, month, onDone }: { sheet: Sheet; whose: Whose; month: string; onDone: (s: Sheet) => void }) {
  const [days, setDays] = useState(s.normManual ? String(s.normDays) : '')
  const save = useMutation<Sheet, ApiError, number | undefined>({
    mutationFn: (value) => unwrap(api.PUT('/api/salaries/timesheet/norm', { body: { ...whose, month, days: value } })),
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(days ? Number(days) : undefined)
  }
  return (
    <form className="timesheet-norm" aria-label="Норма дней" onSubmit={submit}>
      <label className="field"><span>Норма дней в месяце</span>
        <input inputMode="numeric" value={days} placeholder={`по графику: ${s.plannedDays}`} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></label>
      <button type="submit" className="btn" disabled={save.isPending}>{days ? 'Задать норму' : 'По графику'}</button>
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
    </form>
  )
}
