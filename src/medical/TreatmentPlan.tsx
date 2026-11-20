import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { stagesOf } from '../lib/planStages'
import { somText } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { PlanDocs } from '../print/PlanDocs'
import { useMe } from '../api/me'
import { LabOrderDialog } from '../lab/LabOrderDialog'
import { labKindOf } from '../lab/text'
import { planSaved } from '../lib/planStatus'
import { PlanStatusBar } from './PlanProgress'
import { StepAssignForm, StepAssignMeta } from './PlanStepAssign'
import { PlanTemplateSheet } from './PlanTemplateSheet'
import { PlanRepriceSheet } from './PlanReprice'
import { overdueCount } from '../lib/planSteps'
import './plan.css'

type Patient = Schemas['PatientView']
type Step = Schemas['TreatmentStepView']

/**
 * План лечения пациента — этапы (что сделать, зуб, цена, этап 1–5), отметка «сделано», правка и удаление,
 * врач и срок у этапа (V241, «👤»; у заголовка «Этап N» — всей группе), «📄 Из шаблона», «💲 Обновить цены»,
 * печать и отправка пациенту. Один редактор на медкарту (вкладка «План лечения») и карточку приёма
 * (строка «План лечения ›»): после осмотра врач добавляет этапы, не уходя из приёма. Права — на сервере
 * (ChartService.requireEdit): readOnly — ассистент, он план только смотрит.
 *
 * @param prefill зуб из карты зубов («В план лечения») — подставится в новый этап
 * @param heading заголовок «План лечения» — в медкарте; в строке карточки приёма заголовок уже есть
 */
export function TreatmentPlan({ patient, prefill = null, readOnly, heading = true }: {
  patient: Patient; prefill?: { tooth: number; n: number } | null; readOnly: boolean; heading?: boolean
}) {
  const patientId = patient.id
  const client = useQueryClient()
  const plan = useQuery({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId } } })),
  })
  const empty = { tooth: '', title: '', price: '', stage: '1', service: '' }
  // Вкладка «План» открывается уже с зубом из карты — сразу подставить его
  const [form, setForm] = useState(() => (prefill ? { ...empty, tooth: String(prefill.tooth) } : empty))
  // Услуги прайса: выбрал — название и цена подставились, врач может поправить (V140)
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: !readOnly })
  const priced = (services.data ?? []).filter((x) => x.active)
  const [editing, setEditing] = useState<number | null>(null)
  // Этап «коронка», «винир», «протез»… — «🦷 В лабораторию»: заказ технику с этим зубом
  const me = useMe().data
  const [toLab, setToLab] = useState<Step | null>(null)
  // «👤 Врач и срок»: один этап (key — id) или вся группа «Этап N» (key — 'stage-N')
  const [assigning, setAssigning] = useState<string | null>(null)
  const [tool, setTool] = useState<'template' | 'prices' | null>(null)
  const title = useRef<HTMLInputElement>(null)
  // Пришёл зуб из карты — подставить в новый этап (состояние меняем при отрисовке, без эффекта)
  const [applied, setApplied] = useState(prefill)
  if (prefill !== applied) {
    setApplied(prefill)
    if (prefill) setForm((f) => ({ ...f, tooth: String(prefill.tooth) }))
  }
  useEffect(() => {
    if (prefill) {
      title.current?.scrollIntoView?.({ block: 'center' })
      title.current?.focus()
    }
  }, [prefill])
  // Этапы поменялись — и статус плана («В работе», «Завершён», снятый отказ) пересчитать
  const saved = (steps: Step[]) => planSaved(client, patientId, steps)

  const add = useMutation<Schemas['TreatmentStepView'][], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/plan', {
      params: { path: { patientId } },
      body: {
        title: form.title.trim(), tooth: form.tooth ? Number(form.tooth) : undefined, priceSom: form.price ? Number(form.price) : undefined,
        stage: Number(form.stage), serviceTypeId: form.service ? Number(form.service) : undefined,
      },
    })),
    onSuccess: (steps) => {
      saved(steps)
      // Этап оставляем: врач обычно добавляет подряд несколько процедур одного этапа
      setForm({ ...empty, stage: form.stage })
    },
  })
  const toggle = useMutation<Schemas['TreatmentStepView'][], ApiError, Schemas['TreatmentStepView']>({
    mutationFn: (s) => unwrap(api.PUT('/api/patients/{patientId}/plan/{stepId}', {
      params: { path: { patientId, stepId: s.id } }, body: { tooth: s.tooth, title: s.title, priceSom: s.priceSom, stage: s.stage, done: !s.doneAt },
    })),
    onSuccess: saved,
  })
  const remove = useMutation<Schemas['TreatmentStepView'][], ApiError, number>({
    mutationFn: (stepId) => unwrap(api.DELETE('/api/patients/{patientId}/plan/{stepId}', { params: { path: { patientId, stepId } } })),
    onSuccess: saved,
  })

  const steps = plan.data ?? []
  // Этапы показываем, только когда их больше одного: «сначала — потом»
  const stages = stagesOf(steps.filter((x) => !x.doneAt))
  const staged = stages.length > 1
  const total = steps.reduce((s, x) => s + (x.priceSom ?? 0), 0)
  const left = steps.filter((x) => !x.doneAt).reduce((s, x) => s + (x.priceSom ?? 0), 0)
  const error = add.error ?? toggle.error ?? remove.error
  const overdue = overdueCount(steps)
  // «Обновить цены» — есть несделанные этапы с услугой из прайса (только их цену берём из прайса)
  const repriceable = steps.some((x) => !x.doneAt && x.serviceTypeId != null)
  // Пустое «Что сделать» — не молча выключенная кнопка, а подсказка, что вписать
  const [missing, setMissing] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (form.title.trim()) add.mutate()
    else {
      setMissing(true)
      title.current?.focus()
    }
  }

  return (
    <section className="card-block">
      {heading
        ? <h2>План лечения{total ? <span className="hint"> · {somText(total)}{left && left !== total ? `, осталось ${somText(left)}` : ''}</span> : null}</h2>
        : total ? <p className="hint small">{somText(total)}{left && left !== total ? `, осталось ${somText(left)}` : ''}</p> : null}
      {steps.length > 0 && <PlanStatusBar patientId={patientId} readOnly={readOnly} />}
      {overdue > 0 && <p className="plan-overdue-line" role="status">⏱ Просрочен{overdue > 1 ? 'о' : ''} {overdue} {overdue === 1 ? 'этап' : overdue < 5 ? 'этапа' : 'этапов'} — срок прошёл, не сделано</p>}
      {steps.length > 0 && (
        <ul className="plan" aria-label="Этапы лечения">
          {steps.map((s, i) => (
            <Fragment key={s.id}>
            {staged && !s.doneAt && steps[i - 1]?.stage !== s.stage && (
              <li className="plan-stage">
                <span>Этап {s.stage}{stageTotal(stages, s.stage) ? <span className="hint"> · {somText(stageTotal(stages, s.stage))}</span> : null}</span>
                {!readOnly && (
                  <button type="button" className="btn ghost small" aria-label={`Врач и срок: этап ${s.stage}`} title="Врач и срок всего этапа"
                    onClick={() => setAssigning(`stage-${s.stage}`)}>👤</button>
                )}
              </li>
            )}
            {staged && !s.doneAt && steps[i - 1]?.stage !== s.stage && assigning === `stage-${s.stage}` && (
              <li className="plan-assign-row">
                <StepAssignForm patientId={patientId} label={`Врач и срок: этап ${s.stage}`} current={s}
                  stepIds={steps.filter((x) => !x.doneAt && x.stage === s.stage).map((x) => x.id)}
                  onDone={(fresh) => { if (fresh) saved(fresh); setAssigning(null) }} />
              </li>
            )}
            <li className={s.doneAt ? 'done' : s.overdue ? 'overdue' : undefined}>
              {editing === s.id ? (
                <StepEdit patientId={patientId} step={s} onDone={(steps) => { if (steps) saved(steps); setEditing(null) }} />
              ) : assigning === String(s.id) ? (
                <StepAssignForm patientId={patientId} stepIds={[s.id]} label={`Врач и срок: ${s.title}`} current={s}
                  onDone={(fresh) => { if (fresh) saved(fresh); setAssigning(null) }} />
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={Boolean(s.doneAt)} disabled={readOnly || toggle.isPending} onChange={() => toggle.mutate(s)}
                      aria-label={`Сделано: ${s.title}`} />
                    <span>{s.tooth ? <b>{s.tooth} · </b> : null}{s.title}<StepAssignMeta step={s} /></span>
                  </label>
                  <span className="nowrap">{s.priceSom != null ? somText(s.priceSom) : ''}</span>
                  {!readOnly && me && !s.doneAt && labKindOf(s.title) && (
                    <button type="button" className="btn ghost small" aria-label={`В лабораторию: ${s.title}`} title="Заказ в лабораторию" onClick={() => setToLab(s)}>🦷</button>
                  )}
                  {!readOnly && !s.doneAt && (
                    <button type="button" className="btn ghost small" aria-label={`Врач и срок: ${s.title}`} title="Врач и срок"
                      onClick={() => setAssigning(String(s.id))}>👤</button>
                  )}
                  {!readOnly && <button type="button" className="btn ghost small" aria-label={`Изменить этап: ${s.title}`} onClick={() => setEditing(s.id)}>✏️</button>}
                </>
              )}
              {!readOnly && (
                <button type="button" className="btn ghost small" aria-label={`Удалить этап: ${s.title}`}
                  onClick={() => void ask(`Удалить этап «${s.title}»?`).then((ok) => ok && remove.mutate(s.id))}>✕</button>
              )}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
      {toLab && me && (
        <LabOrderDialog me={me} preset={{ patient: { id: patient.id, fullName: patient.fullName }, kind: labKindOf(toLab.title) ?? undefined,
          teeth: toLab.tooth != null ? String(toLab.tooth) : undefined }} onClose={() => setToLab(null)} />
      )}
      {!readOnly && plan.isSuccess && (
        <div className="actions plan-tools">
          <button type="button" className="btn" onClick={() => setTool('template')}>📄 Из шаблона</button>
          {repriceable && <button type="button" className="btn" onClick={() => setTool('prices')}>💲 Обновить цены</button>}
        </div>
      )}
      {tool === 'template' && (
        <PlanTemplateSheet patientId={patientId} steps={steps} onClose={() => setTool(null)} onAdded={(fresh) => { saved(fresh); setTool(null) }} />
      )}
      {tool === 'prices' && <PlanRepriceSheet patientId={patientId} onClose={() => setTool(null)} onSaved={(fresh) => { saved(fresh); setTool(null) }} />}
      {/* Печать и отправка — и ассистенту (без цен): он отдаёт план пациенту */}
      <PlanDocs patient={patient} steps={steps} />
      {plan.isSuccess && steps.length === 0 && <EmptyState compact title="Плана лечения пока нет">{readOnly ? null : 'Добавьте первый этап ниже.'}</EmptyState>}
      {!readOnly && <form className="plan-add" aria-label="Новый этап" onSubmit={submit} data-advance
        onChange={() => { setMissing(false); if (add.isSuccess) add.reset() }}>
        {priced.length > 0 && (
          <Select aria-label="Услуга из прайса" className="plan-service" value={form.service} onChange={(e) => {
            const picked = priced.find((x) => String(x.id) === e.target.value)
            setForm({ ...form, service: e.target.value, title: picked?.name ?? form.title,
              price: picked?.priceSom != null ? String(picked.priceSom) : form.price })
          }}>
            <option value="">Из прайса — или впишите сами</option>
            {priced.map((x) => <option key={x.id} value={String(x.id)}>{x.name}{x.priceSom != null ? ` · ${somText(x.priceSom)}` : ''}</option>)}
          </Select>
        )}
        <input aria-label="Зуб" placeholder="Зуб" inputMode="numeric" value={form.tooth} onChange={(e) => setForm({ ...form, tooth: e.target.value })} />
        <input ref={title} aria-label="Что сделать" placeholder="Что сделать: пломба, чистка…" value={form.title} maxLength={200}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input aria-label="Цена, сом" placeholder="Цена" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <Select aria-label="Этап лечения" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
          {STAGES.map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
        </Select>
        <button type="submit" className="btn primary plan-submit" disabled={add.isPending}>＋ Добавить в план</button>
        {missing && <p className="error plan-hint" role="alert">Впишите, что сделать, — или выберите услугу из прайса</p>}
        {add.isSuccess && <p className="tone-ok small plan-hint" role="status">Добавлено в план — сохранено</p>}
      </form>}
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
    </section>
  )
}

/** Этапы лечения: 1 — сначала, 2 — потом… (сервер принимает 1–9; больше пяти не бывает). */
const STAGES = [1, 2, 3, 4, 5]

function stageTotal(stages: ReturnType<typeof stagesOf<Step>>, stage?: number): number {
  return stages.find((x) => x.stage === stage)?.total ?? 0
}

/** Правка этапа: зуб, что сделать, цена и этап; отметка «сделано» остаётся как была. */
function StepEdit({ patientId, step, onDone }: { patientId: number; step: Step; onDone: (steps?: Step[]) => void }) {
  const [f, setF] = useState({ tooth: step.tooth != null ? String(step.tooth) : '', title: step.title ?? '', price: step.priceSom != null ? String(step.priceSom) : '',
    stage: String(step.stage) })
  const save = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/plan/{stepId}', {
      params: { path: { patientId, stepId: step.id } },
      body: { tooth: f.tooth ? Number(f.tooth) : undefined, title: f.title.trim(), priceSom: f.price ? Number(f.price) : undefined,
        stage: Number(f.stage), done: Boolean(step.doneAt) },
    })),
    onSuccess: (steps) => onDone(steps),
  })
  return (
    <form className="plan-add step-edit" aria-label={`Этап: ${step.title}`} onSubmit={(e) => { e.preventDefault(); if (f.title.trim()) save.mutate() }}>
      <input aria-label="Зуб этапа" placeholder="Зуб" inputMode="numeric" value={f.tooth} onChange={(e) => setF({ ...f, tooth: e.target.value })} />
      <input aria-label="Что сделать на этапе" value={f.title} maxLength={200} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input aria-label="Цена этапа, сом" placeholder="Цена" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
      <Select aria-label="Этап лечения этого шага" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
        {STAGES.map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
      </Select>
      <button type="submit" className="btn primary" disabled={save.isPending || !f.title.trim()}>Сохранить</button>
      <button type="button" className="btn ghost" onClick={() => onDone()}>Отмена</button>
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
    </form>
  )
}
