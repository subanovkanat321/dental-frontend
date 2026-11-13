import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useUnsaved } from '../lib/unsaved'

type Me = Schemas['BookingViewsMe']
type Member = Schemas['StaffMembersMemberView']

/** Врачи-галочки: ассистент помогает одному или нескольким. */
export function DoctorChecks({ me, value, onChange }: { me: Me; value: number[]; onChange: (ids: number[]) => void }) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  return (
    <fieldset className="checks" aria-label="Каким врачам помогает">
      <legend>Каким врачам помогает</legend>
      {doctors.map((d) => (
        <label key={d.id} className="check">
          <input type="checkbox" checked={value.includes(d.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, d.id] : value.filter((x) => x !== d.id))} /> {d.fullName}
        </label>
      ))}
    </fieldset>
  )
}

/** Строка ассистента: его врачи и «изменить». */
export function AssistantDoctors({ me, member }: { me: Me; member: Member }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [ids, setIds] = useState<number[]>(member.doctorIds ?? [])
  const sorted = (list: number[]) => [...list].sort((a, b) => a - b).join()
  const dirty = editing && sorted(ids) !== sorted(member.doctorIds ?? [])
  useUnsaved(dirty)
  const names = (member.doctorIds ?? []).map((id) => me.doctors?.find((d) => d.id === id)?.fullName).filter(Boolean)
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/members/{telegramId}/doctors', { params: { path: { telegramId: member.telegramId } }, body: { doctorIds: ids } })),
    onSuccess: () => {
      setEditing(false)
      void client.invalidateQueries({ queryKey: ['members'] })
    },
  })
  if (!editing) {
    return (
      <>
        <div className="hint">Помогает: {names.join(', ') || '—'}{' '}
          <button type="button" className="link" onClick={() => { save.reset(); setIds(member.doctorIds ?? []); setEditing(true) }}>изменить</button></div>
        <SaveBar dirty={false} saving={false} saved={save.isSuccess} savedText="Врачи ассистента сохранены" />
      </>
    )
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} aria-label={`Врачи ассистента ${member.fullName ?? ''}`}>
      <DoctorChecks me={me} value={ids} onChange={setIds} />
      <div className="actions">
        <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Отмена</button>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} saved={false} disabled={!ids.length}
        error={save.error && (save.error.fieldErrors.doctorIds ?? save.error.message)} />
    </form>
  )
}
