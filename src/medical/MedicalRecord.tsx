import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { shortDate } from '../lib/time'
import { AnamnesisBlock, MedAlerts } from './Anamnesis'
import { useAnamnesis } from '../api/anamnesis'
import { TreatmentPlan } from './TreatmentPlan'
import { TOOTH_STATES, hasSurfaces, stateText, type Surface, type ToothState } from './toothStates'
import { PatientFiles } from './PatientFiles'
import { ToothFormula } from './ToothFormula'
import { DentitionSwitch } from './DentitionSwitch'
import { dentitionByAge, type Dentition } from './dentition'
import { ToothFigure, ToothLegendItem } from './ToothGlyph'
import { TeethHistory } from './TeethHistory'
import { SurfacePicker } from './SurfaceDiagram'
import { MultiToothPanel } from './MultiTeeth'
import { ToothFullscreen } from './ToothFullscreen'
import './toothChart.css'

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
  const id = patient.id
  // Стрелка Telegram — туда же, откуда пришли (к приёму или к списку пациентов)
  useBack(onBack)
  const teeth = useQuery({
    queryKey: ['teeth', id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth', { params: { path: { patientId: id } } })),
  })
  const forbidden = denied(teeth.error)
  // «В план лечения» из зуба: номер подставится в новый этап; счётчик — чтобы тот же зуб можно было ещё раз
  const [planTooth, setPlanTooth] = useState<{ tooth: number; n: number } | null>(null)
  // Медкарта — вкладками, а не простынёй: зубы (что есть) отдельно от плана (что сделать)
  const [tab, setTab] = useState<MedTab>('teeth')
  const plan = useQuery({
    queryKey: ['plan', id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan', { params: { path: { patientId: id } } })),
    enabled: !forbidden,
    retry: false,
  })
  const anamnesis = useAnamnesis(id, !forbidden)
  const marked = (teeth.data ?? []).filter((t) => t.state && t.state !== 'HEALTHY').length
  const left = (plan.data ?? []).filter((s) => !s.doneAt).length
  const tabs: [MedTab, string][] = [
    ['teeth', `🦷 Зубы${marked ? ` · ${marked}` : ''}`],
    ['plan', `🗂 План лечения${left ? ` · ${left}` : ''}`],
    ['anamnesis', '📋 Анкета'],
    ['files', '📷 Снимки и фото'],
    ['notes', '📝 Заметки'],
  ]

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
          {/* Аллергии и важное из анкеты — на виду на любой вкладке */}
          <MedAlerts an={anamnesis.data} compact />
          <div className="segments tabs med-tabs" role="tablist" aria-label="Разделы медкарты">
            {tabs.map(([key, title]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>
            ))}
          </div>
          {tab === 'teeth' && (
            <>
              <ToothChart patient={patient} teeth={teeth.data} error={teeth.error?.message} readOnly={readOnly}
                onPlan={(tooth) => { setPlanTooth({ tooth, n: (planTooth?.n ?? 0) + 1 }); setTab('plan') }} />
              <TeethHistory patientId={id} />
            </>
          )}
          {tab === 'plan' && <TreatmentPlan patient={patient} prefill={planTooth} readOnly={readOnly} />}
          {tab === 'anamnesis' && <AnamnesisBlock patientId={id} readOnly={readOnly} />}
          {tab === 'files' && <PatientFiles patientId={id} readOnly={readOnly} />}
          {tab === 'notes' && <Notes patientId={id} />}
        </>
      )}
    </section>
  )
}

type MedTab = 'teeth' | 'plan' | 'anamnesis' | 'files' | 'notes'

/** Все состояния для «Выбрать несколько» — как в редакторе одного зуба. */
const ALL_STATES = Object.keys(TOOTH_STATES) as State[]

function ToothChart({ patient, teeth, error, onPlan, readOnly }: {
  patient: Patient; teeth?: Tooth[]; error?: string; onPlan: (tooth: number) => void; readOnly: boolean
}) {
  const patientId = patient.id
  const patientName = patient.fullName
  const client = useQueryClient()
  // Прикус (V163): выбранный у пациента, иначе по возрасту. Ассистент переключает только у себя на экране
  const [saved, setSaved] = useState<Dentition | null>(patient.dentition ?? null)
  const dentition = saved ?? dentitionByAge(patient.birthDate)
  const saveDentition = useMutation<Patient, ApiError, Dentition | null>({
    mutationFn: (d) => unwrap(api.PUT('/api/patients/{patientId}/dentition', { params: { path: { patientId } }, body: d ? { dentition: d } : {} })),
    onSuccess: (fresh) => {
      setSaved(fresh.dentition ?? null)
      // Карточки пациента и приёмов держат PatientView — там тоже новый прикус
      void client.invalidateQueries({ queryKey: ['patient-card', patientId] })
      void client.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: () => setSaved(patient.dentition ?? null),
  })
  const changeDentition = (d: Dentition | null) => {
    setSaved(d)
    if (!readOnly) saveDentition.mutate(d)
  }
  const [open, setOpen] = useState<number | null>(null)
  // «Выбрать несколько»: явный переключатель — на телефоне нет Shift и долгое нажатие неочевидно
  const [multi, setMulti] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [full, setFull] = useState(false)
  const byNumber = new Map((teeth ?? []).map((t) => [t.number, t]))
  // Отмеченные зубы списком — заметки видно сразу, без нажатия на каждый (на телефоне подсказки нет)
  const marked = (teeth ?? []).filter((t) => t.state !== 'HEALTHY' || t.note).sort((x, y) => x.number - y.number)
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
      <DentitionSwitch value={dentition} saved={saved} birthDate={patient.birthDate} onChange={changeDentition}
        disabled={saveDentition.isPending} />
      {saveDentition.error && <p className="error" role="alert">{saveDentition.error.message}</p>}
      {error && <p className="error">{error}</p>}
      <details className="hint small tooth-help">
        <summary>Как читать номера зубов?</summary>
        Международная нумерация (FDI). Первая цифра — где: 1 верх справа, 2 верх слева, 3 низ слева, 4 низ справа (у пациента).
        Вторая — какой по счёту от центра: 1 — передний, 8 — зуб мудрости. Карта — как смотрит врач: правая сторона пациента слева.
        Молочные зубы — четверти 5–8 (5 верх справа, 6 верх слева, 7 низ слева, 8 низ справа), зубы 1–5: 51 — на месте 11,
        85 — на месте 45; нарисованы мельче. «Сменный» — молочные на местах 1–5, пока молочный не отмечен «удалён» и постоянный
        на его месте не отмечен, и постоянные моляры 6–8.
        Кружок под зубом — поверхности: центр — жевательная (у передних — режущий край), по краям — мезиальная, дистальная,
        вестибулярная и язычная/нёбная.
      </details>
      <ToothFormula render={tooth} dentition={dentition} teeth={teeth} />
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
            const text = <><b className="num">{t.number}</b> {TOOTH_STATES[t.state ?? 'HEALTHY'][1]} {stateText(t.number, t.state ?? 'HEALTHY', t.surfaces)}</>
            return (
              <li key={t.number}>
                {readOnly ? <span>{text}</span> : (
                  <button type="button" className="row-link" onClick={() => { setMulti(false); setPicked([]); setOpen(t.number) }}>{text}</button>
                )}
                {t.note && <span className="hint"> — {t.note}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {full && teeth && <ToothFullscreen teeth={teeth} dentition={dentition} patientName={patientName} onClose={() => setFull(false)} />}
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
            {/* Заметки всех врачей пациента: чужая — только для чтения, с «Врач: …» (кто вёл приём) */}
            <span className="hint">{n.startAt ? shortDate(n.startAt) : ''}{n.editable === false
              ? (n.visitDoctorName ? ` · Врач: ${n.visitDoctorName}` : '')
              : (n.doctorName ? ` · ${n.doctorName}` : '')}</span>
            <p>{n.note}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
