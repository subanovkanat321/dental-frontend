import { useState } from 'react'

import { useTasks, useTaskStatus, type Task } from './api'
import { TaskDialog, type TaskPatient } from './TaskDialog'
import { TaskRow } from './TaskRow'
import './tasks.css'

/**
 * Блок «Задачи» в карточке пациента: открытые задачи о нём (галочка — выполнить) и «＋ Задача» с этим пациентом.
 * Задач нет — только кнопка, без пустого заголовка.
 */
export function PatientTasks({ patient, adding, onAdding }: {
  patient: TaskPatient
  /** «＋ Задача» снаружи (строка ссылок в карточке пациента): открыть новую задачу; тогда своей кнопки нет */
  adding?: boolean
  onAdding?: (on: boolean) => void
}) {
  const list = useTasks({ status: 'OPEN', patientId: patient.id })
  const status = useTaskStatus()
  const [own, setEditing] = useState<Task | 'new' | null>(null)
  const editing = adding ? 'new' : own
  const close = () => { setEditing(null); onAdding?.(false) }
  const tasks = list.data ?? []
  // Кнопка снаружи и задач нет — пустой секции (и пустой строки) нет, только окно новой задачи
  if (onAdding && !tasks.length && !status.error) {
    return editing ? <TaskDialog task={editing === 'new' ? undefined : editing} patient={patient} onClose={close} /> : null
  }
  return (
    <section className="patient-tasks" aria-label="Задачи пациента">
      <div className="patient-tasks-head">
        {tasks.length > 0 && <h3>Задачи <span className="hint">{tasks.length}</span></h3>}
        {!onAdding && <button type="button" className="btn small" onClick={() => setEditing('new')}>＋ Задача</button>}
      </div>
      {tasks.length > 0 && (
        <ul className="calm-list">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={{ ...t, patientName: undefined }} showAssignee onEdit={setEditing}
              onToggle={(task) => status.mutate({ id: task.id, done: task.status === 'OPEN' })}
              busy={status.isPending && status.variables?.id === t.id} />
          ))}
        </ul>
      )}
      {status.error && <p className="error" role="alert">{status.error.message}</p>}
      {editing && <TaskDialog task={editing === 'new' ? undefined : editing} patient={patient} onClose={close} />}
    </section>
  )
}
