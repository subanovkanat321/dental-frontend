import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, fetchBlob, unwrap, upload, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { shortDate, somText, todayIn } from '../lib/time'
import { AnamnesisBlock } from './Anamnesis'
import { resizePhoto } from './thumb'

type Patient = Schemas['PatientView']
type Tooth = Schemas['ToothView']
type State = NonNullable<Tooth['state']>
type FileView = Schemas['PatientFilesView']
type Kind = NonNullable<FileView['kind']>

const TOOTH_STATES: Record<State, [string, string]> = {
  HEALTHY: ['Здоров', '⚪'],
  CARIES: ['Кариес', '🟤'],
  TREATING: ['Лечится', '🟠'],
  FILLING: ['Пломба', '🔵'],
  CROWN: ['Коронка', '👑'],
  IMPLANT: ['Имплант', '🔩'],
  MISSING: ['Удалён', '✖️'],
}

/**
 * Зубы по FDI так, как врач смотрит на пациента: сверху верхняя челюсть (правая сторона
 * пациента — 18…11, левая — 21…28), снизу нижняя (48…41 и 31…38). На большом экране — по 16 в ряд.
 */
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

const KINDS: [Kind, string][] = [['XRAY', 'Снимок'], ['PHOTO', 'Фото'], ['OTHER', 'Другое']]

/** 403 — не «нет доступа к CRM», а «не ваш пациент»: медкарту видят врач его приёмов и админ. */
function denied(error: unknown): string | null {
  return error instanceof ApiError && error.status === 403 ? error.message : null
}

/**
 * Медкарта в CRM: анкета (аллергии, болезни), карта зубов, план лечения, заметки о визитах и снимки — то же, что в
 * приложении, но на большом экране. Права проверяет сервер.
 */
export function MedicalRecord({ patient, onBack, backLabel = '← К списку' }: { patient: Patient; onBack: () => void; backLabel?: string }) {
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
          <AnamnesisBlock patientId={id} />
          <ToothChart patientId={id} teeth={teeth.data} error={teeth.error?.message}
            onPlan={(tooth) => setPlanTooth({ tooth, n: (planTooth?.n ?? 0) + 1 })} />
          <Plan patientId={id} prefill={planTooth} />
          <Notes patientId={id} />
          <Files patientId={id} />
        </>
      )}
    </section>
  )
}

function ToothChart({ patientId, teeth, error, onPlan }: { patientId: number; teeth?: Tooth[]; error?: string; onPlan: (tooth: number) => void }) {
  const client = useQueryClient()
  const [open, setOpen] = useState<number | null>(null)
  const byNumber = new Map((teeth ?? []).map((t) => [t.number, t]))
  // Отмеченные зубы списком — заметки видно сразу, без нажатия на каждый (на телефоне подсказки нет)
  const marked = (teeth ?? []).filter((t) => t.state !== 'HEALTHY' || t.note).sort((x, y) => (x.number ?? 0) - (y.number ?? 0))
  const counts = (teeth ?? []).reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.state!]: (acc[t.state!] ?? 0) + 1 }), {})

  const tooth = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state ?? 'HEALTHY'
    const [label, icon] = TOOTH_STATES[state]
    return (
      <button key={n} type="button" className={`tooth${open === n ? ' active' : ''}`} data-state={state}
        aria-label={`Зуб ${n}: ${label}${t?.note ? ', есть заметка' : ''}`} title={t?.note ? `${label}: ${t.note}` : label} onClick={() => setOpen(open === n ? null : n)}>
        <span aria-hidden="true" className="tooth-icon">{state === 'HEALTHY' ? '' : icon}</span>
        <span className="tooth-number">{n}</span>
        {t?.note && <span aria-hidden="true" className="tooth-dot">•</span>}
      </button>
    )
  }

  return (
    <section className="card-block">
      <h2>Карта зубов</h2>
      {error && <p className="error">{error}</p>}
      <div className="jaw" role="group" aria-label="Верхняя челюсть">{UPPER.map(tooth)}</div>
      <div className="jaw" role="group" aria-label="Нижняя челюсть">{LOWER.map(tooth)}</div>
      <p className="hint legend">
        {Object.entries(TOOTH_STATES).filter(([k]) => k !== 'HEALTHY')
          .map(([k, [label, icon]]) => `${icon} ${label}${counts[k] ? ` · ${counts[k]}` : ''}`).join('   ')}
      </p>
      {open != null && (
        <ToothEditor key={open} patientId={patientId} number={open} tooth={byNumber.get(open)}
          onSaved={(fresh) => { client.setQueryData(['teeth', patientId], fresh); setOpen(null) }} onCancel={() => setOpen(null)}
          onPlan={() => { onPlan(open); setOpen(null) }} />
      )}
      {marked.length > 0 && (
        <ul className="marked-teeth" aria-label="Отмеченные зубы">
          {marked.map((t) => (
            <li key={t.number}>
              <button type="button" className="row-link" onClick={() => setOpen(t.number!)}>
                <b className="num">{t.number}</b> {TOOTH_STATES[t.state ?? 'HEALTHY'][1]} {TOOTH_STATES[t.state ?? 'HEALTHY'][0]}
              </button>
              {t.note && <span className="hint"> — {t.note}</span>}
            </li>
          ))}
        </ul>
      )}
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
  const save = useMutation<Tooth[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/teeth/{number}', {
      params: { path: { patientId, number } }, body: { state, note: note.trim() || undefined },
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
      <label className="field"><span>Заметка</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        <button type="button" className="btn" onClick={onPlan}>В план лечения</button>
        <button type="button" className="btn" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}

type Step = Schemas['TreatmentStepView']

function Plan({ patientId, prefill }: { patientId: number; prefill: { tooth: number; n: number } | null }) {
  const client = useQueryClient()
  const plan = useQuery({
    queryKey: ['plan', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId } } })),
  })
  const [form, setForm] = useState({ tooth: '', title: '', price: '' })
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
      body: { title: form.title.trim(), tooth: form.tooth ? Number(form.tooth) : undefined, priceSom: form.price ? Number(form.price) : undefined },
    })),
    onSuccess: (steps) => {
      saved(steps)
      setForm({ tooth: '', title: '', price: '' })
    },
  })
  const toggle = useMutation<Schemas['TreatmentStepView'][], ApiError, Schemas['TreatmentStepView']>({
    mutationFn: (s) => unwrap(api.PUT('/api/patients/{patientId}/plan/{stepId}', {
      params: { path: { patientId, stepId: s.id! } }, body: { tooth: s.tooth, title: s.title, priceSom: s.priceSom, done: !s.doneAt },
    })),
    onSuccess: saved,
  })
  const remove = useMutation<Schemas['TreatmentStepView'][], ApiError, number>({
    mutationFn: (stepId) => unwrap(api.DELETE('/api/patients/{patientId}/plan/{stepId}', { params: { path: { patientId, stepId } } })),
    onSuccess: saved,
  })

  const steps = plan.data ?? []
  const total = steps.reduce((s, x) => s + (x.priceSom ?? 0), 0)
  const left = steps.filter((x) => !x.doneAt).reduce((s, x) => s + (x.priceSom ?? 0), 0)
  const error = add.error ?? toggle.error ?? remove.error
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (form.title.trim()) add.mutate()
  }

  return (
    <section className="card-block">
      <h2>План лечения{total ? <span className="hint"> · {somText(total)}{left && left !== total ? `, осталось ${somText(left)}` : ''}</span> : null}</h2>
      {steps.length > 0 && (
        <ul className="plan" aria-label="Этапы лечения">
          {steps.map((s) => (
            <li key={s.id} className={s.doneAt ? 'done' : undefined}>
              {editing === s.id ? (
                <StepEdit patientId={patientId} step={s} onDone={(steps) => { if (steps) saved(steps); setEditing(null) }} />
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={Boolean(s.doneAt)} disabled={toggle.isPending} onChange={() => toggle.mutate(s)}
                      aria-label={`Сделано: ${s.title}`} />
                    <span>{s.tooth ? <b>{s.tooth} · </b> : null}{s.title}</span>
                  </label>
                  <span className="nowrap">{s.priceSom != null ? somText(s.priceSom) : ''}</span>
                  <button type="button" className="btn ghost small" aria-label={`Изменить этап: ${s.title}`} onClick={() => setEditing(s.id!)}>✏️</button>
                </>
              )}
              <button type="button" className="btn ghost small" aria-label={`Удалить этап: ${s.title}`}
                onClick={() => window.confirm(`Удалить этап «${s.title}»?`) && remove.mutate(s.id!)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {plan.isSuccess && steps.length === 0 && <p className="hint">Плана пока нет — добавьте первый этап.</p>}
      <form className="plan-add" aria-label="Новый этап" onSubmit={submit}>
        <input aria-label="Зуб" placeholder="Зуб" inputMode="numeric" value={form.tooth} onChange={(e) => setForm({ ...form, tooth: e.target.value })} />
        <input ref={title} aria-label="Что сделать" placeholder="Что сделать: пломба, чистка…" value={form.title} maxLength={200}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input aria-label="Цена, сом" placeholder="Цена" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <button type="submit" className="btn" disabled={add.isPending || !form.title.trim()}>＋ Этап</button>
      </form>
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
    </section>
  )
}

/** Правка этапа: зуб, что сделать и цена; отметка «сделано» остаётся как была. */
function StepEdit({ patientId, step, onDone }: { patientId: number; step: Step; onDone: (steps?: Step[]) => void }) {
  const [f, setF] = useState({ tooth: step.tooth != null ? String(step.tooth) : '', title: step.title ?? '', price: step.priceSom != null ? String(step.priceSom) : '' })
  const save = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/plan/{stepId}', {
      params: { path: { patientId, stepId: step.id! } },
      body: { tooth: f.tooth ? Number(f.tooth) : undefined, title: f.title.trim(), priceSom: f.price ? Number(f.price) : undefined, done: Boolean(step.doneAt) },
    })),
    onSuccess: (steps) => onDone(steps),
  })
  return (
    <form className="plan-add step-edit" aria-label={`Этап: ${step.title}`} onSubmit={(e) => { e.preventDefault(); if (f.title.trim()) save.mutate() }}>
      <input aria-label="Зуб этапа" placeholder="Зуб" inputMode="numeric" value={f.tooth} onChange={(e) => setF({ ...f, tooth: e.target.value })} />
      <input aria-label="Что сделать на этапе" value={f.title} maxLength={200} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input aria-label="Цена этапа, сом" placeholder="Цена" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
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

/** Миниатюра с сервера — через blob (нужен заголовок сайта), ссылка освобождается при уходе. */
function Thumb({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let url: string | undefined
    let alive = true
    fetchBlob(path).then((blob) => {
      if (!alive) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    }).catch(() => {})
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])
  return src ? <img src={src} alt={alt} /> : <span className="thumb-wait" aria-hidden="true">🩻</span>
}

function Files({ patientId }: { patientId: number }) {
  const client = useQueryClient()
  const files = useQuery({
    queryKey: ['files', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/files', { params: { path: { patientId } } })),
  })
  const [kind, setKind] = useState<Kind>('XRAY')
  const [caption, setCaption] = useState('')
  const [takenOn, setTakenOn] = useState(todayIn())
  const [status, setStatus] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const send = async (picked: File[]) => {
    let done = 0
    for (const file of picked) {
      setStatus(`Загружаем ${done + 1} из ${picked.length}…`)
      try {
        const form = new FormData()
        form.append('file', await resizePhoto(file, 2560, 0.9), 'image.jpg')
        form.append('thumb', await resizePhoto(file, 400, 0.8), 'thumb.jpg')
        form.append('kind', kind)
        if (caption.trim()) form.append('caption', caption.trim())
        if (takenOn) form.append('takenOn', takenOn)
        await upload(`/api/patients/${patientId}/files`, form)
        done++
      }
      catch (e) {
        setStatus(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : `«${file.name}» — не картинка или не открылась`)
        break
      }
    }
    if (done === picked.length) {
      setStatus(`Загружено: ${done}`)
      setCaption('')
    }
    if (input.current) input.current.value = ''
    void client.invalidateQueries({ queryKey: ['files', patientId] })
  }

  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (fileId) => unwrap(api.DELETE('/api/patients/{patientId}/files/{fileId}', { params: { path: { patientId, fileId } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['files', patientId] }),
  })
  const open = async (f: FileView) => {
    const blob = await fetchBlob(`/api/patients/${patientId}/files/${f.id}`)
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  }

  return (
    <section className="card-block">
      <h2>Снимки и фото{files.data?.length ? <span className="hint"> · {files.data.length}</span> : null}</h2>
      {files.data?.length ? (
        <ul className="files">
          {files.data.map((f) => (
            <li key={f.id}>
              <button type="button" className="file" onClick={() => void open(f)} aria-label={`Открыть: ${f.caption ?? KINDS.find(([k]) => k === f.kind)?.[1]}`}>
                <Thumb path={`/api/patients/${patientId}/files/${f.id}?thumb=true`} alt="" />
              </button>
              <span>{f.caption ?? KINDS.find(([k]) => k === f.kind)?.[1]}</span>
              <span className="hint">{f.takenOn ? shortDate(`${f.takenOn}T12:00:00Z`) : ''}{f.createdBy ? ` · ${f.createdBy}` : ''}</span>
              {f.canDelete && (
                <button type="button" className="link danger-link" onClick={() => window.confirm('Удалить снимок?') && remove.mutate(f.id!)}>Удалить</button>
              )}
            </li>
          ))}
        </ul>
      ) : files.isSuccess ? <p className="hint">Снимков пока нет.</p> : null}
      <div className="upload">
        <div className="segments" role="group" aria-label="Что загружаем">
          {KINDS.map(([k, name]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{name}</button>)}
        </div>
        <input aria-label="Подпись" placeholder="Подпись — необязательно" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} />
        <input aria-label="Дата снимка" type="date" value={takenOn} max={todayIn()} onChange={(e) => setTakenOn(e.target.value)} />
        <label className="btn primary">
          📷 Сфотографировать
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Сфотографировать снимок"
            onChange={(e) => e.target.files?.length && void send([...e.target.files])} />
        </label>
        <label className="btn">
          ＋ Выбрать файлы
          <input ref={input} type="file" accept="image/*" multiple className="sr-only" aria-label="Файлы снимков"
            onChange={(e) => e.target.files?.length && void send([...e.target.files])} />
        </label>
      </div>
      {status && <p role="status" className={status.startsWith('Загружено') ? 'tone-ok' : 'hint'}>{status}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  )
}
