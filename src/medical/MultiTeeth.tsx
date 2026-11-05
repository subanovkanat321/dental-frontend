import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { somText } from '../lib/time'
import { SurfacePicker } from './SurfaceDiagram'
import { TOOTH_STATES, hasSurfaces, type Surface, type ToothState } from './toothStates'
import './toothChart.css'

type Step = Schemas['TreatmentStepView']

/**
 * Панель «Выбрать несколько»: одно действие сразу всем отмеченным зубам — состояние (и одни и те же
 * поверхности: «кариес О» на нескольких молярах — обычное дело), «В план лечения» (этап на каждый зуб)
 * и «Снять выбор». Запросы — пакетные (один запрос — всё или ничего), права проверяет сервер, как у одного зуба.
 *
 * @param onApply поставить состояние всем; панель показывает его ошибку и ожидание
 * @param patientId есть — доступно «В план лечения»
 */
export function MultiToothPanel({ numbers, states, onApply, applying, error, patientId, onClear }: {
  numbers: number[]
  states: ToothState[]
  onApply: (state: ToothState, surfaces: Surface[]) => void
  applying: boolean
  error: ApiError | null
  patientId?: number
  onClear: () => void
}) {
  const [state, setState] = useState<ToothState | null>(null)
  const [surfaces, setSurfaces] = useState<Surface[]>([])
  const [planning, setPlanning] = useState(false)
  const sorted = [...numbers].sort((a, b) => a - b)
  if (numbers.length === 0) {
    return <p className="hint small" role="status">Нажмите зубы, которые нужно отметить, — у выбранных появится галочка.</p>
  }
  return (
    <section className="multi-panel" aria-label="Действия с выбранными зубами">
      <h3>Выбрано зубов: {numbers.length} <span className="hint num">· {sorted.join(', ')}</span></h3>
      <div className="segments wrap" role="group" aria-label="Состояние для всех выбранных">
        {states.map((k) => (
          <button key={k} type="button" aria-pressed={state === k} onClick={() => setState(k)}>{TOOTH_STATES[k][1]} {TOOTH_STATES[k][0]}</button>
        ))}
      </div>
      {hasSurfaces(state) && <SurfacePicker value={surfaces} onChange={setSurfaces} state={state} />}
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={!state || applying}
          onClick={() => state && onApply(state, hasSurfaces(state) ? surfaces : [])}>
          Поставить всем{state ? `: ${TOOTH_STATES[state][0].toLowerCase()}` : ''}
        </button>
        {patientId != null && (
          <button type="button" className="btn" aria-expanded={planning} onClick={() => setPlanning(!planning)}>В план лечения</button>
        )}
        <button type="button" className="btn ghost" onClick={onClear}>Снять выбор</button>
      </div>
      {planning && patientId != null && (
        <PlanForTeeth patientId={patientId} numbers={sorted} onDone={() => { setPlanning(false); onClear() }} />
      )}
    </section>
  )
}

const STAGES = [1, 2, 3, 4, 5]

/** Один этап каждому выбранному зубу: «Пломба» на 16, 26, 36 — три строки плана одним запросом. */
function PlanForTeeth({ patientId, numbers, onDone }: { patientId: number; numbers: number[]; onDone: () => void }) {
  const client = useQueryClient()
  const [f, setF] = useState({ service: '', title: '', price: '', stage: '1' })
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  const priced = (services.data ?? []).filter((x) => x.active)
  const add = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/plan/batch', {
      params: { path: { patientId } },
      body: {
        teeth: numbers, title: f.title.trim(), priceSom: f.price ? Number(f.price) : undefined, stage: Number(f.stage),
        serviceTypeId: f.service ? Number(f.service) : undefined,
      },
    })),
    onSuccess: (steps) => {
      client.setQueryData(['plan', patientId], steps)
      onDone()
    },
  })
  const [missing, setMissing] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (f.title.trim()) add.mutate()
    else setMissing(true)
  }
  return (
    <form className="multi-plan" aria-label="В план лечения выбранным зубам" onSubmit={submit}>
      {priced.length > 0 && (
        <Select aria-label="Услуга из прайса" className="plan-service" value={f.service} onChange={(e) => {
          const picked = priced.find((x) => String(x.id) === e.target.value)
          setF({ ...f, service: e.target.value, title: picked?.name ?? f.title, price: picked?.priceSom != null ? String(picked.priceSom) : f.price })
        }}>
          <option value="">Из прайса — или впишите сами</option>
          {priced.map((x) => <option key={x.id} value={String(x.id)}>{x.name}{x.priceSom != null ? ` · ${somText(x.priceSom)}` : ''}</option>)}
        </Select>
      )}
      <input className="multi-plan-title" aria-label="Что сделать каждому зубу" placeholder="Что сделать: пломба, коронка…" maxLength={200}
        value={f.title} onChange={(e) => { setMissing(false); setF({ ...f, title: e.target.value }) }} />
      <input aria-label="Цена за зуб, сом" placeholder="Цена за зуб" type="number" min={0} value={f.price}
        onChange={(e) => setF({ ...f, price: e.target.value })} />
      <Select aria-label="Этап лечения" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
        {STAGES.map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
      </Select>
      <button type="submit" className="btn primary" disabled={add.isPending}>Добавить {numbers.length} в план</button>
      {missing && <p className="error multi-plan-title" role="alert">Впишите, что сделать, — или выберите услугу из прайса</p>}
      {add.error && <p className="error multi-plan-title" role="alert">{Object.values(add.error.fieldErrors)[0] ?? add.error.message}</p>}
    </form>
  )
}
