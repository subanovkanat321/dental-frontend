import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

import { ask } from '../lib/confirm'
import { EmptyState } from '../layout/EmptyState'
import { Fold } from '../layout/Fold'
import { HeadTools } from '../layout/PageHead'
import { Loading } from '../layout/Loading'
import { TASKS, useDeleteTask, useTasks, useTaskStatus, type Task } from './api'
import { GROUP_TITLES, groupTasks } from './group'
import { TaskDialog } from './TaskDialog'
import { TaskRow } from './TaskRow'
import './tasks.css'

/** Сколько держать «Вернуть» после галочки. */
export const UNDO_MS = 6000

/**
 * «Пациенты → Задачи»: открытые задачи группами по сроку — «Просрочено» (красным), «Сегодня», «Позже», «Без срока»;
 * внизу свёрнуто «Выполненные» (последние 100). Галочка слева — выполнить, «Вернуть» — несколько секунд после неё
 * и в «Выполненных». «Мои / Все» — чьи задачи; «＋ Задача» — справа в шапке.
 */
export function TasksTab({ onOpenPatient, initialTask, initialDraft }: {
  onOpenPatient?: (patientId: number) => void
  /** Кнопка «Открыть» под напоминанием в боте — эта задача */
  initialTask?: number
  /** «✏️ Изменить» под карточкой помощника в боте — новая задача с этими полями */
  initialDraft?: Schemas['AssistDraft']
}) {
  const [mine, setMine] = useState(true)
  const open = useTasks({ status: 'OPEN', mine })
  const [showDone, setShowDone] = useState(false)
  const done = useTasks({ status: 'DONE', mine }, showDone)
  const status = useTaskStatus()
  const remove = useDeleteTask()
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [undo, setUndo] = useState<Task | null>(null)
  const groups = useMemo(() => groupTasks(open.data ?? []), [open.data])

  // Пришли из бота («Открыть» под напоминанием) — сразу эта задача; закрыли — больше не открываем
  const [linkClosed, setLinkClosed] = useState(false)
  const linked = useQuery({
    queryKey: [...TASKS, 'one', initialTask],
    queryFn: () => unwrap(api.GET('/api/tasks/{id}', { params: { path: { id: initialTask! } } })),
    enabled: initialTask != null,
  })
  const linkedTask = !linkClosed && linked.data?.status === 'OPEN' && linked.data.canEdit ? linked.data : null
  const [draftClosed, setDraftClosed] = useState(false)
  const draft = !draftClosed && initialDraft?.kind === 'TASK' ? initialDraft : null
  const dialog = editing ?? linkedTask ?? (draft ? 'draft' : null)

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo])

  const toggle = (task: Task) => {
    const doneNow = task.status === 'OPEN'
    status.mutate({ id: task.id, done: doneNow }, { onSuccess: () => setUndo(doneNow ? task : null) })
  }
  const del = async (task: Task) => {
    if (await ask(`Удалить задачу «${task.title}»?`, { ok: 'Удалить', danger: true })) remove.mutate(task.id)
  }
  const row = (t: Task) => (
    <TaskRow key={t.id} task={t} showAssignee={!mine} onToggle={toggle} onEdit={setEditing} onOpenPatient={onOpenPatient} onDelete={del}
      busy={status.isPending && status.variables?.id === t.id} />
  )

  return (
    <div className="calm-stack tasks">
      <HeadTools>
        <div className="segments" role="group" aria-label="Чьи задачи">
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>Мои</button>
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>Все</button>
        </div>
        <button type="button" className="btn primary head-end" onClick={() => setEditing('new')}>＋ Задача</button>
      </HeadTools>
      {undo && (
        <div className="undo" role="status">
          <span>✓ Выполнено: {undo.title}</span>
          <button type="button" className="link" onClick={() => { status.mutate({ id: undo.id, done: false }); setUndo(null) }}>Вернуть</button>
        </div>
      )}
      {(status.error ?? remove.error) && <p className="error" role="alert">{(status.error ?? remove.error)!.message}</p>}
      {open.isPending && <Loading />}
      {open.error && <p className="error">{open.error.message}</p>}
      {open.isSuccess && groups.length === 0 && (
        <EmptyState fill title={mine ? 'У вас нет открытых задач' : 'Открытых задач нет'}>
          «＋ Задача» — перезвонить пациенту, заказать материал, напомнить про оплату. В срок придёт напоминание.
        </EmptyState>
      )}
      {groups.map(([group, tasks]) => (
        <section key={group} className={`calm-day task-group g-${group}`} aria-label={GROUP_TITLES[group]}>
          <h3>{GROUP_TITLES[group]} <span className="hint">{tasks.length}</span></h3>
          <ul className="calm-list">{tasks.map(row)}</ul>
        </section>
      ))}
      <Fold title="Выполненные" label="Выполненные задачи" defaultOpen={showDone} onToggle={setShowDone}>
        {done.isPending ? <Loading /> : done.data?.length
          ? <ul className="calm-list">{done.data.map(row)}</ul>
          : <p className="hint">Пока ничего не выполнено.</p>}
      </Fold>
      {dialog && (
        <TaskDialog key={typeof dialog === 'string' ? dialog : dialog.id} task={typeof dialog === 'string' ? undefined : dialog}
          draft={dialog === 'draft' && draft ? draft : undefined}
          onClose={() => { setEditing(null); setLinkClosed(true); setDraftClosed(true) }} />
      )}
    </div>
  )
}
