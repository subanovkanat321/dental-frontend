import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'
import { ChoiceCards } from '../layout/ChoiceCards'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { Sheet } from '../layout/Sheet'
import { TimeInput } from '../layout/TimeInput'
import { Spinner } from '../layout/Loading'
import { formatPhone, minutesOfTime, slotInstant } from '../lib/time'
import { openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { useDebounced } from '../lib/useDebounced'
import { TASKS, useAssignees } from '../tasks/api'
import { quickDues } from '../tasks/group'
import {
  GROUPS, SKIP_TEXT, VARIABLES, insertAt, patientsText, tasksText, type GroupRef, type Members, type MessageView,
} from './groupsModel'

type How = 'tasks' | 'message'

/**
 * «Позвать группу» — одно главное действие страницы группы, два способа карточками: «📋 Задачи на обзвон» (задача
 * каждому — кому и к какому сроку) и «💬 Сообщение» (текст с подстановками и предпросмотр; в бот — само, без бота —
 * «WhatsApp по очереди»). После отправки сообщения — ход отправки и очередь WhatsApp ({@link MessageProgress}).
 */
export function GroupCall({ group, members, onClose }: {
  group: GroupRef
  members: Members
  onClose: () => void
}) {
  const [how, setHow] = useState<How>('tasks')
  const [sentId, setSentId] = useState<number | null>(null)
  const [tasksDone, setTasksDone] = useState<Schemas['SegmentServiceTasksResult'] | null>(null)
  const subtitle = `${members.name} · ${patientsText(members.total)}`
  if (sentId != null) {
    return (
      <Sheet label="Сообщение группе" title="Сообщение группе" onClose={onClose} wide>
        <MessageProgress id={sentId} />
      </Sheet>
    )
  }
  return (
    <Sheet label="Позвать группу" title="Позвать группу" onClose={onClose} wide>
      <p className="hint group-call-sub">{subtitle}</p>
      {tasksDone ? (
        <div className="group-call-done" role="status">
          <p><b>Создано: {tasksText(tasksDone.created)}</b>{tasksDone.skipped > 0 && <> · у {patientsText(tasksDone.skipped)} такая задача уже есть</>}</p>
          <p className="hint">Задачи — в «Пациенты → Задачи», исполнителю придёт напоминание в срок.</p>
          <div className="confirm-actions">
            <a className="btn" href="#/patients/tasks" onClick={onClose}>Открыть «Задачи»</a>
            <button type="button" className="btn primary" onClick={onClose}>Готово</button>
          </div>
        </div>
      ) : (
        <>
          <ChoiceCards label="Как позвать" value={how} onChange={setHow} choices={[
            { value: 'tasks', icon: '📋', title: 'Задачи на обзвон', text: 'Задача каждому пациенту: позвонить и записать. Повторов не будет.' },
            { value: 'message', icon: '💬', title: 'Сообщение', text: 'В бот — само, без бота — WhatsApp по очереди.' },
          ]} />
          {how === 'tasks'
            ? <TasksForm group={group} members={members} onDone={setTasksDone} />
            : <MessageForm group={group} members={members} onSent={setSentId} />}
        </>
      )}
    </Sheet>
  )
}

function TasksForm({ group, members, onDone }: { group: GroupRef; members: Members; onDone: (r: Schemas['SegmentServiceTasksResult']) => void }) {
  const quick = quickDues()
  const [title, setTitle] = useState(members.taskTitle)
  const [date, setDate] = useState(quick[0]!.date)
  const [time, setTime] = useState(quick[0]!.time)
  const [assignee, setAssignee] = useState<number | null>(null)
  const assignees = useAssignees()
  const me = assignees.data?.find((a) => a.me)
  const chosen = assignee ?? me?.telegramId ?? ''
  const client = useQueryClient()
  const create = useMutation<Schemas['SegmentServiceTasksResult'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-groups/tasks', {
      body: { group, title, assigneeId: assignee ?? undefined, dueAt: date ? slotInstant(date, minutesOfTime(time || '10:00')) : undefined },
    })),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: GROUPS })
      void client.invalidateQueries({ queryKey: TASKS })
      onDone(r)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  return (
    <form className="group-call-form" onSubmit={submit}>
      <label className="field"><span>Что сделать</span>
        <input value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="field">
        <span id="group-due-label">Срок</span>
        <div className="chips-pick task-quick" role="group" aria-labelledby="group-due-label">
          {quick.map((q) => (
            <button key={q.label} type="button" className="chip" aria-pressed={date === q.date && time === q.time}
              onClick={() => { setDate(q.date); setTime(q.time) }}>{q.label}</button>
          ))}
        </div>
        <div className="row task-due-row">
          <DateInput aria-label="Дата срока" value={date} placeholder="Дата" onChange={(e) => setDate(e.target.value)} />
          <TimeInput aria-label="Время срока" value={time} disabled={!date} onChange={setTime} />
        </div>
      </div>
      <label className="field"><span>Кому</span>
        <Select value={chosen} onChange={(e) => setAssignee(Number(e.target.value))} disabled={!assignees.data}>
          {(assignees.data ?? []).map((a) => (
            <option key={a.telegramId} value={a.telegramId}>{a.me ? `Я (${a.fullName})` : `${a.fullName} — ${a.role}`}</option>
          ))}
        </Select></label>
      {create.error && <p className="error" role="alert">{create.error.fieldErrors.title ?? create.error.fieldErrors.group ?? create.error.message}</p>}
      <div className="confirm-actions">
        <button type="submit" className="btn primary" disabled={create.isPending || !title.trim() || members.total === 0}>
          {create.isPending ? <><Spinner />Создаём…</> : `Создать ${tasksText(members.total)}`}</button>
      </div>
    </form>
  )
}

function MessageForm({ group, members, onSent }: { group: GroupRef; members: Members; onSent: (id: number) => void }) {
  const [text, setText] = useState(members.messageText)
  const area = useRef<HTMLTextAreaElement>(null)
  const asked = useDebounced(text)
  const client = useQueryClient()
  const preview = useQuery({
    queryKey: [...GROUPS, 'preview', group, asked],
    queryFn: () => unwrap(api.POST('/api/patient-groups/preview', { body: { group, text: asked } })),
    enabled: asked.trim().length > 0,
    retry: false,
  })
  const send = useMutation<MessageView, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-groups/send', { body: { group, text } })),
    onSuccess: (m) => {
      void client.invalidateQueries({ queryKey: GROUPS })
      onSent(m.id)
    },
  })
  const insert = (token: string) => {
    const el = area.current
    const next = insertAt(text, token, el ? el.selectionStart : null, el ? el.selectionEnd : null)
    setText(next.text)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }
  const reachable = members.total - members.optedOut
  const noBot = Math.max(0, reachable - members.inBot)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate()
  }
  return (
    <form className="group-call-form" onSubmit={submit}>
      <label className="field"><span>Текст</span>
        <textarea ref={area} value={text} rows={5} maxLength={2000} required onChange={(e) => setText(e.target.value)} /></label>
      <div className="chips-pick group-vars" role="group" aria-label="Подставить">
        {VARIABLES.map((v) => <button key={v.token} type="button" className="chip" onClick={() => insert(v.token)}>＋ {v.label}</button>)}
      </div>
      <div className="group-preview" aria-label="Как придёт">
        <span className="hint small">{preview.data?.fullName ? `Так увидит ${preview.data.fullName}` : 'Так придёт'} · подпись с телефоном добавится сама</span>
        {preview.error ? <p className="error">{preview.error.message}</p> : <p className="group-preview-text">{preview.data?.text ?? '…'}</p>}
      </div>
      <p className="calm-note">
        В бот: <b className="num">{members.inBot}</b> — уйдёт само, с кнопкой «Записаться». Без бота: <b className="num">{noBot}</b> — WhatsApp по очереди.
        {' '}Кто получал сообщение группы за последние 7 дней или отказался, — пропустим.
      </p>
      {send.error && <p className="error" role="alert">{send.error.fieldErrors.text ?? send.error.fieldErrors.group ?? send.error.message}</p>}
      <div className="confirm-actions">
        <button type="submit" className="btn primary" disabled={send.isPending || !text.trim() || members.total === 0}>
          {send.isPending ? <><Spinner />Отправляем…</> : 'Отправить'}</button>
      </div>
    </form>
  )
}

/**
 * Ход сообщения группе: «Отправлено в бот 12 из 40» (обновляется, пока идёт), пропущенные с причиной и «WhatsApp по
 * очереди» — один пациент за раз: «Открыть WhatsApp» с готовым текстом, потом «✓ Написали» — следующий.
 */
export function MessageProgress({ id }: { id: number }) {
  const client = useQueryClient()
  const view = useQuery({
    queryKey: [...GROUPS, 'message', id],
    queryFn: () => unwrap(api.GET('/api/patient-groups/messages/{id}', { params: { path: { id } } })),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  })
  const [skippedIds, setSkippedIds] = useState<number[]>([])
  const written = useMutation<MessageView, ApiError, number>({
    mutationFn: (patientId) => unwrap(api.POST('/api/patient-groups/messages/{id}/written/{patientId}', { params: { path: { id, patientId } } })),
    onSuccess: (m) => client.setQueryData([...GROUPS, 'message', id], m),
  })
  const m = view.data
  if (!m) return view.error ? <p className="error">{view.error.message}</p> : <p className="hint"><Spinner />Загрузка…</p>
  const left = m.queue.filter((q) => !q.written)
  const current = left.find((q) => !skippedIds.includes(q.patientId)) ?? left[0]
  const done = m.bot > 0 ? m.sent + m.failed : 0
  return (
    <div className="group-progress">
      <p className="hint group-call-sub">{m.name}</p>
      {m.bot > 0 && (
        <section className="group-progress-block" aria-label="В бот">
          <p><b>В бот: отправлено <span className="num">{m.sent}</span> из <span className="num">{m.bot}</span></b>
            {m.running && <span className="hint"> · отправляем понемногу, окно можно закрыть</span>}</p>
          <div className="bot-tile-bar" role="progressbar" aria-valuemin={0} aria-valuemax={m.bot} aria-valuenow={done}>
            <span style={{ width: `${Math.round((done / m.bot) * 100)}%` }} /></div>
          {m.failed > 0 && <p className="hint small">Не дошло: {m.failed} — пациент мог удалить чат с ботом.</p>}
        </section>
      )}
      {m.whatsapp > 0 && (
        <section className="group-progress-block" aria-label="WhatsApp по очереди">
          <p><b>WhatsApp по очереди: написали <span className="num">{m.written}</span> из <span className="num">{m.whatsapp}</span></b></p>
          {current ? (
            <div className="group-queue-card">
              <p className="group-queue-name"><strong>{current.fullName}</strong>{current.phone && <span className="num hint"> · {formatPhone(current.phone)}</span>}</p>
              <p className="group-preview-text">{current.text}</p>
              <div className="confirm-actions">
                {left.length > 1 && (
                  <button type="button" className="btn quiet" onClick={() => setSkippedIds((s) => {
                    // Пропустили всех оставшихся — очередь идёт по кругу заново
                    const next = [...s, current.patientId]
                    return left.every((q) => next.includes(q.patientId)) ? [] : next
                  })}>Позже</button>
                )}
                <button type="button" className="btn" disabled={written.isPending} onClick={() => written.mutate(current.patientId)}>✓ Написали</button>
                <button type="button" className="btn primary" disabled={!current.phone}
                  onClick={() => current.phone && openLink(whatsappUrl(current.phone, current.text))}>Открыть WhatsApp</button>
              </div>
            </div>
          ) : <p className="hint">Всем написали ✓</p>}
        </section>
      )}
      {m.bot === 0 && m.whatsapp === 0 && <p>Никому не отправлено — все пропущены.</p>}
      {m.skipped.length > 0 && (
        <details className="group-skipped">
          <summary>Пропущено: {m.skipped.length}</summary>
          <ul>{m.skipped.map((s) => <li key={s.patientId}>{s.fullName} — <span className="hint">{SKIP_TEXT[s.reason]}</span></li>)}</ul>
        </details>
      )}
      {written.error && <p className="error" role="alert">{written.error.message}</p>}
    </div>
  )
}
