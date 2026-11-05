import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { shortDate, somText } from '../lib/time'
import { AnamnesisBlock } from './Anamnesis'
import { PlanDocs } from '../print/PlanDocs'
import { stagesOf } from '../lib/planStages'
import { TOOTH_STATES, hasSurfaces, stateText, type Surface, type ToothState } from './toothStates'
import { PatientFiles } from './PatientFiles'
import { ToothFormula } from './ToothFormula'
import { ToothFigure, ToothLegendItem } from './ToothGlyph'
import { TeethHistory } from './TeethHistory'
import { SurfacePicker } from './SurfaceDiagram'
import { MultiToothPanel } from './MultiTeeth'
import { ToothFullscreen } from './ToothFullscreen'
import './toothChart.css'
import { Select } from '../layout/Select'

type Patient = Schemas['PatientView']
type Tooth = Schemas['ToothView']
type State = ToothState

/** 403 — не «нет доступа к CRM», а «не ваш пациент»: медкарту видят врач его приёмов и админ. */
function denied(error: unknown): string | null {
  return error instanceof ApiError && error.status === 403 ? error.message : null
}

/**
 * Медкарта в CRM: анкета (аллергии, болезни), карта зубов, план лечения, заметки о визитах и снимки — то же, что в
 * приложении, но на большом экране. Права проверяет сервер.
 */
/** @param readOnly ассистент: смотрит анкету, зубы, план и заметки, загружает снимки; править — врач */
export function MedicalRecord({ patient, onBack, backLabel = '← К списку', readOnly = false }: {
  patient: Patient; onBack: () => void; backLabel?: string; readOnly?: boolean
}) {
  const id = patient.id!
  // Стрелка Telegram — туда же, откуда пришли (к приёму или к списку пациентов)
  useBack(onBack)
  const teeth = useQuery({
    queryKey: ['teeth', id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth', { params: { path: { patientId: id } } })),
  })
  const forbidden = denied(teeth.error)
  // «В план лечения» из зуба: номер подставится в новый этап; счётчик — чтобы тот же зуб можно было ещё раз
  const [planTooth, setPlanTooth] = useState<{ tooth: number; n: number } | null>(null)

  return (
    <section className="schedule-main medical">
      <header className="toolbar">
        <button type="button" className="btn" onClick={onBack}>{backLabel}</button>
        <h1>Медкарта · {patient.fullName}</h1>
      </header>
      {forbidden ? (
        <p className="empty">{forbidden}</p>
      ) : (
        <>
          {readOnly && <p className="hint">Вы ассистент: медкарту смотрите и загружаете снимки, записи о лечении ведёт врач.</p>}
          <AnamnesisBlock patientId={id} readOnly={readOnly} />
          <ToothChart patientId={id} patientName={patient.fullName} teeth={teeth.data} error={teeth.error?.message} readOnly={readOnly}
            onPlan={(tooth) => setPlanTooth({ tooth, n: (planTooth?.n ?? 0) + 1 })} />
          <TeethHistory patientId={id} />
          <Plan patient={patient} prefill={planTooth} readOnly={readOnly} />
          <Notes patientId={id} />
          <PatientFiles patientId={id} readOnly={readOnly} />
        </>
      )}
    </section>
  )
}

/** Все состояния для «Выбрать несколько» — как в редакторе одного зуба. */
const ALL_STATES = Object.keys(TOOTH_STATES) as State[]

function ToothChart({ patientId, patientName, teeth, error, onPlan, readOnly }: {
  patientId: number; patientName?: string; teeth?: Tooth[]; error?: string; onPlan: (tooth: number) => void; readOnly: boolean
}) {
  const client = useQueryClient()
  const [open, setOpen] = useState<number | null>(null)
  // «Выбрать несколько»: явный переключатель — на телефоне нет Shift и долгое нажатие неочевидно
  const [multi, setMulti] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [full, setFull] = useState(false)
  const byNumber = new Map((teeth ?? []).map((t) => [t.number, t]))
  // Отмеченные зубы списком — заметки видно сразу, без нажатия на каждый (на телефоне подсказки нет)
  const marked = (teeth ?? []).filter((t) => t.state !== 'HEALTHY' || t.note).sort((x, y) => (x.number ?? 0) - (y.number ?? 0))
  const counts = (teeth ?? []).reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.state!]: (acc[t.state!] ?? 0) + 1 }), {})
  const many = useMutation<Tooth[], ApiError, { state: State; surfaces: Surface[] }>({
    mutationFn: ({ state, surfaces }) => unwrap(api.POST('/api/patients/{patientId}/teeth/batch', {
      params: { path: { patientId } }, body: { numbers: picked, state, surfaces },
    })),
    onSuccess: (fresh) => {
      client.setQueryData(['teeth', patientId], fresh)
      setPicked([])
      setMulti(false)
    },
  })
  const toggleMulti = () => {
    setMulti(!multi)
    setPicked([])
    setOpen(null)
    many.reset()
  }

  const tooth = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state ?? 'HEALTHY'
    const label = stateText(n, state, t?.surfaces)
    const isPicked = picked.includes(n)
    return (
      <button key={n} type="button" className={`tooth${open === n ? ' active' : ''}${isPicked ? ' picked' : ''}`} data-state={state}
        aria-label={`Зуб ${n}: ${label}${t?.note ? ', есть заметка' : ''}`} title={t?.note ? `${label}: ${t.note}` : label}
        aria-pressed={multi ? isPicked : undefined}
        onClick={() => (multi ? setPicked(isPicked ? picked.filter((x) => x !== n) : [...picked, n]) : setOpen(open === n ? null : n))}>
        {isPicked && <span aria-hidden="true" className="tooth-check">✓</span>}
        <ToothFigure number={n} state={state} surfaces={t?.surfaces} ring />
        {t?.note && <span aria-hidden="true" className="tooth-dot">•</span>}
      </button>
    )
  }

  return (
    <section className="card-block">
      <div className="chart-head">
        <h2>Карта зубов</h2>
        {!readOnly && (
          <button type="button" className="btn" aria-pressed={multi} onClick={toggleMulti}>{multi ? '☑' : '☐'} Несколько</button>
        )}
        <button type="button" className="btn" onClick={() => setFull(true)} disabled={!teeth}>⛶ На весь экран</button>
      </div>
      {error && <p className="error">{error}</p>}
      <details className="hint small tooth-help">
        <summary>Как читать номера зубов?</summary>
        Международная нумерация (FDI). Первая цифра — где: 1 верх справа, 2 верх слева, 3 низ слева, 4 низ справа (у пациента).
        Вторая — какой по счёту от центра: 1 — передний, 8 — зуб мудрости. Карта — как смотрит врач: правая сторона пациента слева.
        Кружок под зубом — поверхности: центр — жевательная (у передних — режущий край), по краям — мезиальная, дистальная,
        вестибулярная и язычная/нёбная.
      </details>
      <ToothFormula render={tooth} />
      <p className="hint legend tooth-legend">
        {(Object.keys(TOOTH_STATES) as State[]).filter((k) => k !== 'HEALTHY').map((k) => (
          <ToothLegendItem key={k} state={k} label={`${TOOTH_STATES[k][0]}${counts[k] ? ` · ${counts[k]}` : ''}`} />
        ))}
      </p>
      {multi && !readOnly && (
        <MultiToothPanel key={picked.length === 0 ? 'empty' : 'picked'} numbers={picked} states={ALL_STATES} patientId={patientId}
          onApply={(state, surfaces) => many.mutate({ state, surfaces })} applying={many.isPending} error={many.error}
          onClear={() => { setPicked([]); many.reset() }} />
      )}
      {open != null && !readOnly && !multi && (
        <ToothEditor key={open} patientId={patientId} number={open} tooth={byNumber.get(open)}
          onSaved={(fresh) => { client.setQueryData(['teeth', patientId], fresh); setOpen(null) }} onCancel={() => setOpen(null)}
          onPlan={() => { onPlan(open); setOpen(null) }} />
      )}
      {marked.length > 0 && (
        <ul className="marked-teeth" aria-label="Отмеченные зубы">
          {marked.map((t) => {
            const text = <><b className="num">{t.number}</b> {TOOTH_STATES[t.state ?? 'HEALTHY'][1]} {stateText(t.number ?? 0, t.state ?? 'HEALTHY', t.surfaces)}</>
            return (
              <li key={t.number}>
                {readOnly ? <span>{text}</span> : (
                  <button type="button" className="row-link" onClick={() => { setMulti(false); setPicked([]); setOpen(t.number!) }}>{text}</button>
                )}
                {t.note && <span className="hint"> — {t.note}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {full && teeth && <ToothFullscreen teeth={teeth} patientName={patientName} onClose={() => setFull(false)} />}
    </section>
  )
}

function ToothEditor({ patientId, number, tooth, onSaved, onCancel, onPlan }: {
  patientId: number
  number: number
  tooth?: Tooth
  onSaved: (teeth: Tooth[]) => void
  onCancel: () => void
  onPlan: () => void
}) {
  const [state, setState] = useState<State>(tooth?.state ?? 'HEALTHY')
  const [note, setNote] = useState(tooth?.note ?? '')
  const [surfaces, setSurfaces] = useState<Surface[]>(tooth?.surfaces ?? [])
  // Поверхности — только у кариеса, лечения и пломбы; у коронки и прочих сервер их всё равно очистит
  const sent = hasSurfaces(state) ? surfaces : []
  const changed = state !== (tooth?.state ?? 'HEALTHY') || note.trim() !== (tooth?.note ?? '')
    || sent.join('') !== (hasSurfaces(tooth?.state) ? (tooth?.surfaces ?? []).join('') : '')
  const save = useMutation<Tooth[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/teeth/{number}', {
      params: { path: { patientId, number } }, body: { state, surfaces: sent, note: note.trim() || undefined },
    })),
    onSuccess: onSaved,
  })
  return (
    <form className="form tooth-editor" aria-label={`Зуб ${number}`} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <h3>Зуб {number}{tooth?.updatedAt ? <span className="hint"> · {tooth.doctorName ? `${tooth.doctorName}, ` : ''}{shortDate(tooth.updatedAt)}</span> : null}</h3>
      <div className="segments wrap" role="group" aria-label="Состояние">
        {Object.entries(TOOTH_STATES).map(([k, [label, icon]]) => (
          <button key={k} type="button" aria-pressed={state === k} onClick={() => setState(k as State)}>{icon} {label}</button>
        ))}
      </div>
      {hasSurfaces(state) && <SurfacePicker number={number} value={surfaces} onChange={setSurfaces} state={state} />}
      <label className="field"><span>Заметка</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        {/* Изменили зуб — сначала сохраняем, потом в план: правка не теряется */}
        <button type="button" className="btn" disabled={save.isPending}
          onClick={() => (changed ? save.mutate(undefined, { onSuccess: (fresh) => { onSaved(fresh); onPlan() } }) : onPlan())}>В план лечения</button>
        <button type="button" className="btn" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}

type Step = Schemas['TreatmentStepView']

function Plan({ patient, prefill, readOnly }: { patient: Patient; prefill: { tooth: number; n: number } | null; readOnly: boolean }) {
  const patientId = patient.id!
  const client = useQueryClient()
  const plan = useQuery({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId } } })),
  })
  const empty = { tooth: '', title: '', price: '', stage: '1', service: '' }
  const [form, setForm] = useState(empty)
  // Услуги прайса: выбрал — название и цена подставились, врач может поправить (V140)
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: !readOnly })
  const priced = (services.data ?? []).filter((x) => x.active)
  const [editing, setEditing] = useState<number | null>(null)
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
  const saved = (steps: Step[]) => client.setQueryData(['plan', patientId], steps)

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
      params: { path: { patientId, stepId: s.id! } }, body: { tooth: s.tooth, title: s.title, priceSom: s.priceSom, stage: s.stage, done: !s.doneAt },
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
      <h2>План лечения{total ? <span className="hint"> · {somText(total)}{left && left !== total ? `, осталось ${somText(left)}` : ''}</span> : null}</h2>
      {steps.length > 0 && (
        <ul className="plan" aria-label="Этапы лечения">
          {steps.map((s, i) => (
            <Fragment key={s.id}>
            {staged && !s.doneAt && steps[i - 1]?.stage !== s.stage && (
              <li className="plan-stage">Этап {s.stage}{stageTotal(stages, s.stage) ? <span className="hint"> · {somText(stageTotal(stages, s.stage))}</span> : null}</li>
            )}
            <li className={s.doneAt ? 'done' : undefined}>
              {editing === s.id ? (
                <StepEdit patientId={patientId} step={s} onDone={(steps) => { if (steps) saved(steps); setEditing(null) }} />
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={Boolean(s.doneAt)} disabled={readOnly || toggle.isPending} onChange={() => toggle.mutate(s)}
                      aria-label={`Сделано: ${s.title}`} />
                    <span>{s.tooth ? <b>{s.tooth} · </b> : null}{s.title}</span>
                  </label>
                  <span className="nowrap">{s.priceSom != null ? somText(s.priceSom) : ''}</span>
                  {!readOnly && <button type="button" className="btn ghost small" aria-label={`Изменить этап: ${s.title}`} onClick={() => setEditing(s.id!)}>✏️</button>}
                </>
              )}
              {!readOnly && (
                <button type="button" className="btn ghost small" aria-label={`Удалить этап: ${s.title}`}
                  onClick={() => void ask(`Удалить этап «${s.title}»?`).then((ok) => ok && remove.mutate(s.id!))}>✕</button>
              )}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
      {/* Печать и отправка — и ассистенту (без цен): он отдаёт план пациенту */}
      <PlanDocs patient={patient} steps={steps} />
      {plan.isSuccess && steps.length === 0 && <p className="hint">{readOnly ? 'Плана пока нет.' : 'Плана пока нет — добавьте первый этап.'}</p>}
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
    stage: String(step.stage ?? 1) })
  const save = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/plan/{stepId}', {
      params: { path: { patientId, stepId: step.id! } },
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

function Notes({ patientId }: { patientId: number }) {
  const notes = useQuery({
    queryKey: ['notes', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/notes', { params: { path: { patientId } } })),
  })
  if (!notes.data?.length) return null
  return (
    <section className="card-block">
      <h2>Заметки о визитах</h2>
      <ul className="notes">
        {notes.data.map((n) => (
          <li key={n.appointmentId}>
            <span className="hint">{n.startAt ? shortDate(n.startAt) : ''}{n.doctorName ? ` · ${n.doctorName}` : ''}</span>
            <p>{n.note}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
