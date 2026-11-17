import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { useDebounced } from '../lib/useDebounced'
import { dateOf, formatPhone, minutesOfTime, slotInstant, timeOf } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { TimeInput } from '../layout/TimeInput'
import { Select } from '../layout/Select'
import { useSwipeDown } from '../layout/useSwipeDown'
import { useAssignees, useSaveTask, type Task } from './api'
import { quickDues } from './group'
import './tasks.css'

type Patient = Schemas['PatientView']

/** Пациент задачи: id и имя (из карточки, приёма или поиска). */
export type TaskPatient = { id: number; fullName: string }

/**
 * «＋ Задача» и «Изменить задачу»: что сделать, срок (быстрые кнопки «Сегодня 18:00», «Завтра 10:00», «Через неделю»
 * или дата и время), исполнитель (по умолчанию я) и пациент (поиск; из карточки пациента и приёма — уже выбран).
 * Компьютер — окно по центру, телефон — лист снизу (как layout/Confirm.tsx). Время — по Бишкеку, в API — UTC.
 */
export function TaskDialog({ task, patient: fixedPatient, appointmentId, onClose, onSaved }: {
  /** Изменить эту задачу; нет — новая */
  task?: Task
  /** Пациент из карточки пациента или приёма — сменить нельзя */
  patient?: TaskPatient
  appointmentId?: number
  onClose: () => void
  onSaved?: (task: Task) => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [note, setNote] = useState(task?.note ?? '')
  const [date, setDate] = useState(task?.dueAt ? dateOf(task.dueAt) : '')
  const [time, setTime] = useState(task?.dueAt ? timeOf(task.dueAt) : '')
  const [assignee, setAssignee] = useState<number | null>(task?.assigneeId ?? null)
  const [patient, setPatient] = useState<TaskPatient | null>(fixedPatient
    ?? (task?.patientId != null ? { id: task.patientId, fullName: task.patientName ?? 'Пациент' } : null))
  const assignees = useAssignees()
  const save = useSaveTask()
  const err = (k: string) => save.error?.fieldErrors[k]
  const quick = quickDues()

  useBack(onClose)
  const box = useRef<HTMLFormElement>(null)
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  useSwipeDown(box, phone ? onClose : null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    return () => back?.focus?.()
  }, [])

  const me = assignees.data?.find((a) => a.me)
  const chosen = assignee ?? me?.telegramId ?? ''
  const dueAt = date ? slotInstant(date, minutesOfTime(time || '10:00')) : undefined

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({
      id: task?.id,
      body: {
        title, note: note.trim() || undefined, dueAt,
        assigneeId: assignee ?? undefined,
        patientId: patient?.id,
        appointmentId: task ? task.appointmentId : appointmentId,
      },
    }, { onSuccess: (t) => { onSaved?.(t); onClose() } })
  }

  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" className={phone ? 'confirm task-dialog sheet' : 'confirm task-dialog'}
        onSubmit={submit} onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <h2 id="task-dialog-title">{task ? 'Задача' : 'Новая задача'}</h2>
        <label className="field"><span>Что сделать</span>
          <input value={title} required maxLength={200} autoComplete="off" autoFocus placeholder="Например: перезвонить после удаления"
            onChange={(e) => setTitle(e.target.value)} /></label>
        {err('title') && <p className="error">{err('title')}</p>}

        <div className="field">
          <span id="task-due-label">Срок</span>
          <div className="chips-pick task-quick" role="group" aria-labelledby="task-due-label">
            {quick.map((q) => (
              <button key={q.label} type="button" className="chip" aria-pressed={date === q.date && time === q.time}
                onClick={() => { setDate(q.date); setTime(q.time) }}>{q.label}</button>
            ))}
            <button type="button" className="chip" aria-pressed={!date} onClick={() => { setDate(''); setTime('') }}>Без срока</button>
          </div>
          <div className="row task-due-row">
            <DateInput aria-label="Дата срока" value={date} placeholder="Дата" onChange={(e) => { setDate(e.target.value); if (!time) setTime('10:00') }} />
            <TimeInput aria-label="Время срока" value={time} disabled={!date} onChange={setTime} />
          </div>
        </div>

        <label className="field"><span>Исполнитель</span>
          <Select value={chosen} onChange={(e) => setAssignee(Number(e.target.value))} disabled={!assignees.data}>
            {(assignees.data ?? []).map((a) => (
              <option key={a.telegramId} value={a.telegramId}>{a.me ? `Я (${a.fullName})` : `${a.fullName} — ${a.role}`}</option>
            ))}
          </Select></label>
        {err('assigneeId') && <p className="error">{err('assigneeId')}</p>}

        {fixedPatient ? (
          <p className="task-patient">Пациент: <strong>{fixedPatient.fullName}</strong></p>
        ) : (
          <PatientField patient={patient} onChange={setPatient} />
        )}
        {err('patientId') && <p className="error">{err('patientId')}</p>}

        <label className="field"><span>Подробности <span className="hint">— необязательно</span></span>
          <textarea value={note} rows={2} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>

        {save.error && !Object.keys(save.error.fieldErrors).length && <p className="error" role="alert">{save.error.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={save.isPending || !title.trim()}>{task ? 'Сохранить' : 'Создать'}</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

/** Пациент задачи — необязательно: поиск по имени или номеру, как в листе ожидания. */
function PatientField({ patient, onChange }: { patient: TaskPatient | null; onChange: (p: TaskPatient | null) => void }) {
  const [query, setQuery] = useState('')
  const search = useDebounced(query.trim())
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2 && !patient,
  })
  if (patient) {
    return (
      <p className="task-patient">Пациент: <strong>{patient.fullName}</strong>{' '}
        <button type="button" className="link" onClick={() => onChange(null)}>убрать</button></p>
    )
  }
  return (
    <div className="field">
      <span>Пациент <span className="hint">— необязательно</span></span>
      <input type="search" aria-label="Найти пациента для задачи" placeholder="Имя или номер" value={query} onChange={(e) => setQuery(e.target.value)} />
      {found.data?.length ? (
        <ul className="found">
          {found.data.slice(0, 6).map((p: Patient) => (
            <li key={p.id}><button type="button" onClick={() => { onChange({ id: p.id, fullName: p.fullName }); setQuery('') }}>
              <strong>{p.fullName}</strong>{p.phone && <span className="hint"> · {formatPhone(p.phone)}</span>}
            </button></li>
          ))}
        </ul>
      ) : found.data && search === query.trim() ? <p className="hint small">Не нашли «{search}»</p> : null}
    </div>
  )
}
