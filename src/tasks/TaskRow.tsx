import { CalmRow, RowMenu, type MenuItem } from '../patients/CalmList'
import type { Task } from './api'
import { dueText } from './group'

/**
 * Строка задачи (спокойный список «Пациентов»): слева — кружок-галочка «выполнить», название крупно, под ним
 * серым — кому и пациент, справа — срок (просрочено — красным), «⋯» — изменить, открыть пациента, удалить.
 */
export function TaskRow({ task, showAssignee, onToggle, onEdit, onOpenPatient, onDelete, busy }: {
  task: Task
  /** «Все»: чья задача (у своих — не пишем) */
  showAssignee: boolean
  onToggle: (task: Task) => void
  onEdit?: (task: Task) => void
  onOpenPatient?: (patientId: number) => void
  onDelete?: (task: Task) => void
  busy?: boolean
}) {
  const done = task.status === 'DONE'
  const sub = [
    showAssignee && !task.mine ? task.assigneeName : null,
    task.patientName ? `пациент: ${task.patientName}` : null,
    done && task.doneByName ? `выполнил(а): ${task.doneByName}` : null,
  ].filter(Boolean).join(' · ')
  const items: MenuItem[] = []
  if (onEdit && task.canEdit && !done) items.push({ label: 'Изменить', onSelect: () => onEdit(task) })
  if (onOpenPatient && task.patientId != null && task.patientName) items.push({ label: 'Открыть пациента', onSelect: () => onOpenPatient(task.patientId!) })
  if (done) items.push({ label: 'Вернуть', onSelect: () => onToggle(task) })
  if (onDelete && task.canEdit) items.push({ label: 'Удалить', tone: 'bad', onSelect: () => onDelete(task) })
  return (
    <CalmRow
      open={onEdit && task.canEdit && !done ? () => onEdit(task) : null}
      lead={(
        <button type="button" className={done ? 'task-check done' : 'task-check'} role="checkbox" aria-checked={done} disabled={busy}
          aria-label={done ? `Вернуть: ${task.title}` : `Выполнить: ${task.title}`} onClick={() => onToggle(task)}>
          <span aria-hidden="true">{done ? '✓' : ''}</span>
        </button>
      )}
      name={<span className={done ? 'task-title done' : 'task-title'}>{task.title}</span>}
      sub={sub || undefined}
      meta={done
        ? task.doneAt && <span>{dueText(task.doneAt)}</span>
        : task.dueAt && <span className={task.overdue ? 'task-due overdue' : 'task-due'}>{dueText(task.dueAt)}</span>}
      menu={items.length ? <RowMenu label={`Ещё: ${task.title}`} items={items} /> : undefined}
    />
  )
}
