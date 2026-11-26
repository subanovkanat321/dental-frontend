import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'

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
import { PlanStepSheet } from './PlanStepSheet'
import { PlanTeethPicker } from './PlanTeethPicker'
import { PlanVariantBar } from './PlanVariants'
import { variantsKey } from '../lib/planVariants'
import { overdueCount } from '../lib/planSteps'
import { PRIORITY, priorityGroups, priorityGrouped, priorityOf, priorityText, type Priority } from '../lib/planPriority'
import { PriorityChips } from './PriorityChips'
import { useDiscountPolicy } from '../schedule/discountDraft'
import { PlanDiscountForm } from './PlanDiscount'
import { StepPrice, StepPriceText } from './StepPrice'
import { fromStep, priceOf, totalsOf, totalText } from './stepDiscount'
import './plan.css'

type Patient = Schemas['PatientView']
type Step = Schemas['TreatmentStepView']

/**
 * План лечения пациента — сверху зубная формула (PlanTeethPicker): врач нажимает зубы → «Что сделать» (PlanStepSheet:
 * услуга из прайса или своё описание, цена за зуб) или «＋ Без зуба» (чистка, консультация — «В конце плана»). Ниже этапы:
 * отметка «сделано», «↑ ↓» — порядок, правка и удаление, врач и срок у этапа (V241, «👤»; у заголовка «Этап N» — всей
 * группе), «📄 Из шаблона», «💲 Обновить цены», печать и отправка пациенту. Несколько вариантов плана (V254, PlanVariantBar):
 * вкладки с итогами, «⧉ Ещё вариант», «Пациент выбрал». Один редактор на медкарту (вкладка «План лечения») и карточку
 * приёма (строка «План лечения ›»). Права — на сервере (ChartService.requireEdit): readOnly — ассистент, он план только смотрит.
 * Скидки (V257): у этапа «~~4 500~~ 4 050 сом (−10 %)», итог «…, скидка −…, к оплате …», «🏷 Скидка на выбранные» (зубы на формуле)
 * и «🏷 Скидка на весь план» — по правилам «Настройки → Пациенты и скидки → Скидки».
 * Срочность (V267): есть этап не «🟡 Желательно» — несделанные группами «🔴 Срочно · 12 000 сом», «🟡 Желательно · …»,
 * «🟢 Можно позже · …» (порядок — с сервера: срочность, этап, ↑↓), внутри — «Этап N», ниже «✓ Сделано»; пустых групп нет,
 * «↑ ↓» — внутри группы. Все «Желательно» — как раньше, без групп.
 *
 * @param prefill зуб из карты зубов («В план лечения») — сразу открыть «Что сделать» с этим зубом
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
  // Варианты плана (V254): у обычного плана — один, без названия; не ответил сервер — работаем как с одним
  const variants = useQuery({
    queryKey: variantsKey(patientId),
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan/variants', { params: { path: { patientId } } })),
    retry: false,
  })
  const list = variants.data?.variants ?? []
  const multi = list.length > 1
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const selected = multi
    ? list.find((v) => v.id === selectedId) ?? list.find((v) => v.chosenAt) ?? list.find((v) => v.current) ?? list[0]
    : null
  const isCurrent = !selected || selected.current
  const variantId = isCurrent ? undefined : selected.id
  // Этапы — открытого варианта: основной — из общего кэша ['plan', id] (его видят карточка приёма и «Что сделали сегодня?»)
  const steps = (isCurrent ? plan.data : selected.steps) ?? []
  const [picked, setPicked] = useState<number[]>(() => (prefill ? [prefill.tooth] : []))
  const [sheet, setSheet] = useState<'teeth' | 'general' | null>(() => (prefill && !readOnly ? 'teeth' : null))
  const [editing, setEditing] = useState<number | null>(null)
  // Этап «коронка», «винир», «протез»… — «🦷 В лабораторию»: заказ технику с этим зубом
  const me = useMe().data
  const [toLab, setToLab] = useState<Step | null>(null)
  // «👤 Врач и срок»: один этап (key — id) или вся группа «Этап N» (key — 'stage-N')
  const [assigning, setAssigning] = useState<string | null>(null)
  const [tool, setTool] = useState<'template' | 'prices' | null>(null)
  // «🏷 Скидка»: на этапы выбранных зубов или на весь план (несделанные этапы открытого варианта)
  const [discounting, setDiscounting] = useState<'picked' | 'all' | null>(null)
  const policy = useDiscountPolicy()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: !readOnly })
  const serviceOf = (id?: number | null) => (id == null ? undefined : services.data?.find((x) => x.id === id))
  // Пришёл зуб из карты — выбрать его и открыть «Что сделать» (состояние меняем при отрисовке, без эффекта)
  const [applied, setApplied] = useState(prefill)
  if (prefill !== applied) {
    setApplied(prefill)
    if (prefill) {
      setPicked([prefill.tooth])
      if (!readOnly) setSheet('teeth')
    }
  }
  // Этапы поменялись: основной — в кэш плана и пересчитать статус; любой — перечитать варианты (итоги)
  const saved = (fresh: Step[]) => {
    if (isCurrent) planSaved(client, patientId, fresh)
    void client.invalidateQueries({ queryKey: variantsKey(patientId) })
  }

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
  const move = useMutation<Step[], ApiError, { stepId: number; up: boolean }>({
    mutationFn: ({ stepId, up }) => unwrap(api.POST('/api/patients/{patientId}/plan/{stepId}/move', {
      params: { path: { patientId, stepId } }, body: { up },
    })),
    onSuccess: saved,
  })
  const addVariant = useMutation<Schemas['PlanVariantsVariants'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/plan/variants', { params: { path: { patientId } }, body: {} })),
    onSuccess: (fresh) => {
      client.setQueryData(variantsKey(patientId), fresh)
      setSelectedId(fresh.variants?.[fresh.variants.length - 1]?.id ?? null)
    },
  })

  // Этапы показываем, только когда их больше одного: «сначала — потом»
  const open = steps.filter((x) => !x.doneAt)
  const stages = stagesOf(open)
  const staged = stages.length > 1
  // Срочность (V267): группы — только если есть этап не «Желательно»; сумма группы — к оплате, со скидками этапов
  const grouped = priorityGrouped(open)
  const groups = grouped ? priorityGroups(open) : []
  const groupOf = (p: Priority) => groups.find((g) => g.priority === p)?.items ?? open
  const all = totalsOf(steps)
  const total = all.pay
  const left = totalsOf(open).pay
  const error = toggle.error ?? remove.error ?? move.error ?? addVariant.error
  const overdue = overdueCount(steps)
  // «Обновить цены» — есть несделанные этапы с услугой из прайса (только их цену берём из прайса); только основной вариант
  const repriceable = isCurrent && steps.some((x) => !x.doneAt && x.serviceTypeId != null)
  const loaded = isCurrent ? plan.isSuccess : true
  const sum = total ? `${totalText(all)}${left && left !== total ? `, осталось ${somText(left)}` : ''}` : ''
  const pickedSteps = open.filter((x) => x.tooth != null && picked.includes(x.tooth))
  const canDiscount = !readOnly && Boolean(policy.data?.canGive) && open.some((x) => (x.priceSom ?? 0) > 0)

  return (
    <section className="card-block">
      {/* В карточке приёма сумма, статус и прогресс — в заголовке строки «План лечения»: здесь только кнопки статуса */}
      {heading && <h2>План лечения{sum && !multi ? <span className="hint"> · {sum}</span> : null}</h2>}
      {(plan.data?.length ?? 0) > 0 && <PlanStatusBar patientId={patientId} readOnly={readOnly} actionsOnly={!heading} />}
      {multi && selected && variants.data && (
        <PlanVariantBar patientId={patientId} data={variants.data} selected={selected} onSelect={setSelectedId} readOnly={readOnly} />
      )}
      {loaded && (
        <PlanTeethPicker patient={patient} steps={steps} picked={picked} onPick={setPicked} readOnly={readOnly}
          onWhat={() => setSheet('teeth')} onGeneral={() => setSheet('general')} onTemplate={() => setTool('template')} />
      )}
      {overdue > 0 && <p className="plan-overdue-line" role="status">⏱ Просрочен{overdue > 1 ? 'о' : ''} {overdue} {overdue === 1 ? 'этап' : overdue < 5 ? 'этапа' : 'этапов'} — срок прошёл, не сделано</p>}
      {steps.length > 0 && (
        <ul className="plan" aria-label="Этапы лечения">
          {steps.map((s, i) => {
            // «↑ ↓» — внутри группы срочности (сервер двигает этап среди этапов той же срочности)
            const mine = grouped ? groupOf(priorityOf(s)) : open
            const at = mine.indexOf(s)
            const prev = steps[i - 1]
            const newGroup = grouped && !s.doneAt && (!prev || priorityOf(prev) !== priorityOf(s))
            const newStage = staged && !s.doneAt && (newGroup || prev?.stage !== s.stage)
            const stageSum = grouped ? mine.filter((x) => x.stage === s.stage).reduce((sum, x) => sum + (x.netSom ?? x.priceSom ?? 0), 0)
              : stageTotal(stages, s.stage)
            const group = newGroup ? groups.find((g) => g.priority === priorityOf(s)) : undefined
            return (
            <Fragment key={s.id}>
            {group && (
              <li className={`plan-prio prio-${PRIORITY[group.priority].tone}`} title={PRIORITY[group.priority].hint}>
                <span>{priorityText(group.priority)}{group.total ? <span className="num"> · {somText(group.total)}</span> : null}</span>
              </li>
            )}
            {grouped && s.doneAt && !prev?.doneAt && <li className="plan-prio prio-done"><span>✓ Сделано</span></li>}
            {newStage && (
              <li className="plan-stage">
                <span>Этап {s.stage}{stageSum ? <span className="hint"> · {somText(stageSum)}</span> : null}</span>
                {!readOnly && (
                  <button type="button" className="btn ghost small" aria-label={`Врач и срок: этап ${s.stage}`} title="Врач и срок всего этапа"
                    onClick={() => setAssigning(`stage-${s.stage}`)}>👤</button>
                )}
              </li>
            )}
            {newStage && assigning === `stage-${s.stage}` && (
              <li className="plan-assign-row">
                <StepAssignForm patientId={patientId} label={`Врач и срок: этап ${s.stage}`} current={s}
                  stepIds={open.filter((x) => x.stage === s.stage).map((x) => x.id)}
                  onDone={(fresh) => { if (fresh) saved(fresh); setAssigning(null) }} />
              </li>
            )}
            <li className={[s.doneAt ? 'done' : s.overdue ? 'overdue' : '', s.tooth != null && picked.includes(s.tooth) ? 'picked-row' : ''].filter(Boolean).join(' ') || undefined}>
              {editing === s.id ? (
                <StepEdit patientId={patientId} step={s} policy={policy.data} listPrice={serviceOf(s.serviceTypeId)?.priceSom}
                  onDone={(fresh) => { if (fresh) saved(fresh); setEditing(null) }} />
              ) : assigning === String(s.id) ? (
                <StepAssignForm patientId={patientId} stepIds={[s.id]} label={`Врач и срок: ${s.title}`} current={s}
                  onDone={(fresh) => { if (fresh) saved(fresh); setAssigning(null) }} />
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={Boolean(s.doneAt)} disabled={readOnly || toggle.isPending || !isCurrent} onChange={() => toggle.mutate(s)}
                      aria-label={`Сделано: ${s.title}`} title={isCurrent ? undefined : 'Отмечать сделанным — после выбора этого варианта'} />
                    <span>{s.tooth ? <b>{s.tooth} · </b> : null}{s.title}<StepAssignMeta step={s} />
                      {!s.doneAt && serviceOf(s.serviceTypeId)?.durationMinutes ? (
                        <span className="plan-assign" title="Длительность по прайсу — для записи">⏱ {serviceOf(s.serviceTypeId)?.durationMinutes} мин</span>
                      ) : null}
                    </span>
                  </label>
                  <span className="nowrap num"><StepPriceText step={s} /></span>
                  {!readOnly && !s.doneAt && (
                    <span className="plan-move">
                      <button type="button" className="btn ghost small" aria-label={`Выше: ${s.title}`} title="Выше" disabled={at <= 0 || move.isPending}
                        onClick={() => move.mutate({ stepId: s.id, up: true })}>↑</button>
                      <button type="button" className="btn ghost small" aria-label={`Ниже: ${s.title}`} title="Ниже" disabled={at >= mine.length - 1 || move.isPending}
                        onClick={() => move.mutate({ stepId: s.id, up: false })}>↓</button>
                    </span>
                  )}
                  {!readOnly && me && !s.doneAt && isCurrent && labKindOf(s.title) && (
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
            )
          })}
        </ul>
      )}
      {multi && sum && <p className="plan-variant-sum">Итого по варианту: <b className="num">{sum}</b></p>}
      {toLab && me && (
        <LabOrderDialog me={me} preset={{ patient: { id: patient.id, fullName: patient.fullName }, kind: labKindOf(toLab.title) ?? undefined,
          teeth: toLab.tooth != null ? String(toLab.tooth) : undefined }} onClose={() => setToLab(null)} />
      )}
      {discounting && (
        <PlanDiscountForm patientId={patientId} policy={policy.data}
          steps={discounting === 'picked' ? pickedSteps : open}
          label={discounting === 'picked' ? `Скидка на выбранные: ${[...new Set(pickedSteps.map((x) => x.tooth))].join(', ')}` : 'Скидка на весь план'}
          onDone={(fresh) => { if (fresh) saved(fresh); setDiscounting(null) }} />
      )}
      {!readOnly && loaded && (
        <div className="actions plan-tools">
          {canDiscount && pickedSteps.length > 0 && (
            <button type="button" className="btn" onClick={() => setDiscounting('picked')}>🏷 Скидка на выбранные ({pickedSteps.length})</button>
          )}
          {canDiscount && <button type="button" className="btn" onClick={() => setDiscounting('all')}>🏷 Скидка на весь план</button>}
          <button type="button" className="btn" onClick={() => setTool('template')}>📄 Из шаблона</button>
          {repriceable && <button type="button" className="btn" onClick={() => setTool('prices')}>💲 Обновить цены</button>}
          {!multi && steps.some((x) => !x.doneAt) && variants.isSuccess && (
            <button type="button" className="btn" disabled={addVariant.isPending} onClick={() => addVariant.mutate()}
              title="Копия плана — поменяйте в ней материалы или способ лечения, пациент выберет">⧉ Ещё вариант (дешевле или дороже)</button>
          )}
        </div>
      )}
      {sheet && (
        <PlanStepSheet patientId={patientId} teeth={sheet === 'teeth' ? [...picked].sort((a, b) => a - b) : []} steps={steps} variantId={variantId}
          onClose={() => setSheet(null)} onAdded={(fresh) => { saved(fresh); setSheet(null); setPicked([]) }} />
      )}
      {tool === 'template' && (
        <PlanTemplateSheet patientId={patientId} steps={steps} variantId={variantId} teeth={picked} onClose={() => setTool(null)}
          onAdded={(fresh) => { saved(fresh); setTool(null); setPicked([]) }} />
      )}
      {tool === 'prices' && <PlanRepriceSheet patientId={patientId} onClose={() => setTool(null)} onSaved={(fresh) => { saved(fresh); setTool(null) }} />}
      {/* Печать и отправка — и ассистенту (без цен): он отдаёт план пациенту. Варианты не выбраны — на листе все */}
      <PlanDocs patient={patient} steps={plan.data ?? []} variants={multi && !list.some((v) => v.chosenAt) ? list : undefined} />
      {loaded && steps.length === 0 && (
        <EmptyState compact title={multi ? 'В этом варианте пока нет этапов' : 'Плана лечения пока нет'}>
          {readOnly ? null : 'Нажмите зубы на формуле выше — или «＋ Без зуба».'}
        </EmptyState>
      )}
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
    </section>
  )
}

/** Этапы лечения: 1 — сначала, 2 — потом… (сервер принимает 1–9; больше пяти не бывает). */
const STAGES = [1, 2, 3, 4, 5]

function stageTotal(stages: ReturnType<typeof stagesOf<Step>>, stage?: number): number {
  return stages.find((x) => x.stage === stage)?.total ?? 0
}

/**
 * Правка этапа: зуб, что сделать, цена (со скидкой — StepPrice), этап и срочность; отметка «сделано» остаётся как была. Скидку
 * присылаем всегда: пустая — снять (сервер без поля оставил бы прежнюю).
 */
function StepEdit({ patientId, step, policy, listPrice, onDone }: {
  patientId: number; step: Step; policy?: Schemas['DiscountPoliciesPolicy']; listPrice?: number | null; onDone: (steps?: Step[]) => void
}) {
  const [f, setF] = useState({ tooth: step.tooth != null ? String(step.tooth) : '', title: step.title ?? '', stage: String(step.stage) })
  const [money, setMoney] = useState(() => fromStep(step))
  const [priority, setPriority] = useState<Priority>(priorityOf(step))
  const save = useMutation<Step[], ApiError>({
    mutationFn: () => {
      const p = priceOf(money, policy)
      return unwrap(api.PUT('/api/patients/{patientId}/plan/{stepId}', {
        params: { path: { patientId, stepId: step.id } },
        body: { tooth: f.tooth ? Number(f.tooth) : undefined, title: f.title.trim(), priceSom: p.priceSom,
          stage: Number(f.stage), done: Boolean(step.doneAt), discount: p.discount ?? {}, priority },
      }))
    },
    onSuccess: (steps) => onDone(steps),
  })
  return (
    <form className="plan-add step-edit" aria-label={`Этап: ${step.title}`} onSubmit={(e) => { e.preventDefault(); if (f.title.trim()) save.mutate() }}>
      <input aria-label="Зуб этапа" placeholder="Зуб" inputMode="numeric" value={f.tooth} onChange={(e) => setF({ ...f, tooth: e.target.value })} />
      <input aria-label="Что сделать на этапе" value={f.title} maxLength={200} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} />
      <Select aria-label="Этап лечения этого шага" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
        {STAGES.map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
      </Select>
      <StepPrice value={money} onChange={setMoney} policy={policy} listPrice={listPrice} inputLabel="Цена этапа, сом" />
      <PriorityChips value={priority} onChange={setPriority} />
      <button type="submit" className="btn primary" disabled={save.isPending || !f.title.trim()}>Сохранить</button>
      <button type="button" className="btn ghost" onClick={() => onDone()}>Отмена</button>
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
    </form>
  )
}
