import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { sourceChoices, useSources } from '../lib/sources'
import { formatPhone, todayIn } from '../lib/time'
import { useClose } from '../lib/useClose'

type Patient = Schemas['PatientView']

const FIELDS = ['fullName', 'phone', 'birthDate', 'workplace', 'sourceId'] as const

/**
 * Имя, телефон, дата рождения, место работы и откуда узнал — новый пациент или правка. Те же проверки, что на
 * сервере: ошибки под полями (422), такой номер уже есть (409) — открыть того или «это другой человек».
 */
export function PatientForm({ patient: p, onSaved, onOpenOther, onCancel }: {
  patient?: Patient
  onSaved: (p: Patient) => void
  onOpenOther?: (id: number) => void
  onCancel?: () => void
}) {
  const client = useQueryClient()
  const [f, setF] = useState({ fullName: p?.fullName ?? '', phone: phoneToInput(p?.phone), birthDate: p?.birthDate ?? '', workplace: p?.workplace ?? '', source: p?.sourceId != null ? String(p.sourceId) : '' })
  const sources = useSources()
  const save = useMutation<Patient, ApiError, boolean>({
    mutationFn: (allowDuplicate) => {
      const body = { fullName: f.fullName, phone: phoneFromInput(f.phone), allowDuplicate, birthDate: f.birthDate || undefined, workplace: f.workplace,
        sourceId: f.source ? Number(f.source) : undefined }
      return unwrap(p ? api.PUT('/api/patients/{id}', { params: { path: { id: p.id! } }, body }) : api.POST('/api/patients', { body }))
    },
    onSuccess: (saved) => {
      for (const key of ['patients', 'patient-card', 'appointments']) void client.invalidateQueries({ queryKey: [key] })
      onSaved(saved)
    },
  })
  const err = (k: string) => save.error?.fieldErrors[k]
  const other = save.error?.code === 'duplicate-patient' ? save.error.problem.patient as Patient | undefined : undefined
  const set = (k: keyof typeof f) => (v: string) => {
    save.reset()
    setF({ ...f, [k]: v })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(false)
  }

  return (
    <form className="form" aria-label={p ? 'Данные пациента' : 'Новый пациент'} onSubmit={submit}>
      <label className="field"><span>Имя пациента</span>
        <input value={f.fullName} required maxLength={200} autoComplete="off" autoFocus onChange={(e) => set('fullName')(e.target.value)} /></label>
      {err('fullName') && <p className="error">{err('fullName')}</p>}
      <label className="field"><span>Телефон</span>
        <PhoneInput label="Телефон" value={f.phone} onChange={set('phone')} /></label>
      {err('phone') && <p className="error">{err('phone')}</p>}
      <div className="row">
        <label className="field"><span>Дата рождения</span>
          <input type="date" min="1900-01-01" max={todayIn()} value={f.birthDate} onChange={(e) => set('birthDate')(e.target.value)} /></label>
        <label className="field"><span>Место работы</span>
          <input value={f.workplace} maxLength={200} autoComplete="off" placeholder="Например: школа №5" onChange={(e) => set('workplace')(e.target.value)} /></label>
      </div>
      {(err('birthDate') || err('workplace')) && <p className="error">{err('birthDate') ?? err('workplace')}</p>}
      <label className="field"><span>Откуда узнал о клинике</span>
        <select value={f.source} onChange={(e) => set('source')(e.target.value)}>
          <option value="">Не указано</option>
          {sourceChoices(sources.data, p?.sourceId).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select></label>
      {err('sourceId') && <p className="error">{err('sourceId')}</p>}
      {other ? (
        <div className="duplicate" role="alert">
          <p>{save.error?.message}: {other.fullName}, {other.phone ? formatPhone(other.phone) : ''}</p>
          <div className="actions">
            {onOpenOther && other.id != null && <button type="button" className="btn" onClick={() => onOpenOther(other.id!)}>Открыть его</button>}
            <button type="button" className="btn" onClick={() => save.mutate(true)}>Это другой человек — {p ? 'сохранить' : 'создать'}</button>
          </div>
        </div>
      ) : save.error && !FIELDS.some((k) => err(k)) && <p className="error" role="alert">{save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>}
      </div>
    </form>
  )
}

/** «Новый пациент» справа: карточка без записи — потом анкета, снимки и запись на приём. */
export function NewPatientPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  useClose(onClose)
  return (
    <aside className="panel" aria-label="Новый пациент">
      <header className="panel-head">
        <div>
          <h2>Новый пациент</h2>
          <span className="hint">Карточка без записи: потом анкета, снимки и запись на приём.</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <PatientForm onSaved={(p) => onCreated(p.id!)} onOpenOther={onCreated} />
    </aside>
  )
}
