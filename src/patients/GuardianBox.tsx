import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { ask } from '../lib/confirm'
import { GUARDIAN_RELATION, guardianLine, type GuardianRelation } from '../lib/guardian'
import { Select } from '../layout/Select'

type Patient = Schemas['PatientView']

const RELATIONS = Object.entries(GUARDIAN_RELATION) as [GuardianRelation, string][]

/**
 * «Представитель» во вкладке «Прочее» карточки пациента: родитель или опекун ребёнка (V164 бэкенда) — имя, кем
 * приходится, телефон (пусто — номер из карточки пациента). Есть представитель — бот пишет о записях ему, а
 * «Напомнить в WhatsApp» открывает чат с его номером. Отдельный запрос, не PUT пациента: та форма о нём не знает.
 */
export function GuardianBox({ patient, canEdit }: { patient: Patient; canEdit: boolean }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const refresh = () => {
    for (const key of ['patient-card', 'appointments', 'patients']) void client.invalidateQueries({ queryKey: [key] })
  }
  const remove = useMutation<Patient, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{id}/guardian', { params: { path: { id: patient.id } } })),
    onSuccess: refresh,
  })
  const line = guardianLine(patient)

  return (
    <section className="guardian-box" aria-label="Представитель">
      <h3>Представитель</h3>
      {editing ? (
        <GuardianForm patient={patient} onDone={() => { setEditing(false); refresh() }} onCancel={() => setEditing(false)} />
      ) : (
        <>
          {line ? <p>{line.replace('Представитель: ', '')}</p>
            : <p className="hint">Ребёнок или опекаемый? Добавьте маму, папу или опекуна — напоминания о записи пойдут им.</p>}
          {canEdit && (
            <div className="actions">
              <button type="button" className="link" onClick={() => setEditing(true)}>{line ? 'Изменить' : '＋ Добавить представителя'}</button>
              {line && <button type="button" className="link" disabled={remove.isPending}
                onClick={() => void ask('Убрать представителя? Напоминания снова пойдут самому пациенту.').then((ok) => ok && remove.mutate())}>
                Убрать</button>}
            </div>
          )}
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        </>
      )}
    </section>
  )
}

function GuardianForm({ patient, onDone, onCancel }: { patient: Patient; onDone: () => void; onCancel: () => void }) {
  const g = patient.guardian
  const [f, setF] = useState({ fullName: g?.fullName ?? '', relation: g?.relation ?? 'MOTHER', phone: phoneToInput(g?.phone) })
  const save = useMutation<Patient, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{id}/guardian', {
      params: { path: { id: patient.id } },
      body: { fullName: f.fullName.trim(), relation: f.relation, phone: phoneFromInput(f.phone) || undefined },
    })),
    onSuccess: onDone,
  })
  const err = (k: string) => save.error?.fieldErrors[k]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form className="form" aria-label="Представитель пациента" onSubmit={submit}>
      <label className="field"><span>Имя представителя</span>
        <input value={f.fullName} required maxLength={200} autoComplete="off" placeholder="Айгуль"
          onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
      {err('fullName') && <p className="error">{err('fullName')}</p>}
      <label className="field"><span>Кем приходится</span>
        <Select aria-label="Кем приходится" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value as GuardianRelation })}>
          {RELATIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </Select></label>
      {err('relation') && <p className="error">{err('relation')}</p>}
      <label className="field"><span>Телефон представителя</span>
        <PhoneInput label="Телефон представителя" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></label>
      <p className="hint small">Пусто — номер из карточки пациента.</p>
      {err('phone') && <p className="error">{err('phone')}</p>}
      {save.error && !Object.keys(save.error.fieldErrors).length && <p className="error" role="alert">{save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}
