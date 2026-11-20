import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { assignText } from '../lib/planSteps'
import { addDays, todayIn } from '../lib/time'

type Step = Schemas['TreatmentStepView']

/**
 * Врач и срок у этапа плана (V241): «👤 Иванова А. · до 15 дек» под названием этапа; срок прошёл, а этап не сделан —
 * красная пометка «просрочен». Ничего не назначено — ничего не рисуем.
 */
export function StepAssignMeta({ step: s }: { step: Step }) {
  const text = assignText(s)
  if (!text) return null
  return (
    <span className={s.overdue ? 'plan-assign overdue' : 'plan-assign'}>
      {s.doctorName ? '👤 ' : '⏱ '}{text}{s.overdue && <b className="plan-overdue"> · просрочен</b>}
    </span>
  )
}

/**
 * Форма «Врач и срок»: одному этапу или всей группе «Этап N» (несделанным). Врач — из работающих врачей клиники;
 * «Без врача» и пустой срок — снять. Сохраняет сервер (PUT /plan/assign), ответ — весь план.
 *
 * @param current что стоит сейчас (у группы — у первого этапа): форма открывается с этими значениями
 */
export function StepAssignForm({ patientId, stepIds, label, current, onDone }: {
  patientId: number
  stepIds: number[]
  label: string
  current?: Pick<Step, 'doctorId' | 'dueOn'>
  onDone: (steps?: Step[]) => void
}) {
  const doctors = (useMe().data?.doctors ?? []).filter((d) => d.active || d.id === current?.doctorId)
  const [doctor, setDoctor] = useState(current?.doctorId != null ? String(current.doctorId) : '')
  const [due, setDue] = useState(current?.dueOn ?? '')
  const today = todayIn()
  const save = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/plan/assign', {
      params: { path: { patientId } },
      body: { stepIds, doctorId: doctor ? Number(doctor) : undefined, dueOn: due || undefined },
    })),
    onSuccess: (steps) => onDone(steps),
  })
  return (
    <form className="plan-assign-form" aria-label={label} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Врач</span>
        <Select aria-label="Врач этапа" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
          <option value="">Без врача</option>
          {doctors.map((d) => <option key={d.id} value={String(d.id)}>{d.fullName}</option>)}
        </Select>
      </label>
      <label className="field"><span>Срок до</span>
        <DateInput aria-label="Срок этапа" value={due} min={addDays(today, -365)} max={addDays(today, 3 * 365)}
          onChange={(e) => setDue(e.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        {due && <button type="button" className="btn ghost" onClick={() => setDue('')}>Без срока</button>}
        <button type="button" className="btn ghost" onClick={() => onDone()}>Отмена</button>
      </div>
      {save.error && <p className="error small" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
    </form>
  )
}
