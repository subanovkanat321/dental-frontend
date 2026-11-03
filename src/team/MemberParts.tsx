import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useUnsaved } from '../lib/unsaved'
import { InviteLink } from './InviteLink'
import { ROLE_TEXT } from './texts'

type Role = NonNullable<Schemas['StaffMembersControllerInviteRequest']['role']>
type Me = Schemas['BookingViewsMe']
type Member = Schemas['StaffMembersMemberView']

/** Врачи-галочки: ассистент помогает одному или нескольким. */
function DoctorChecks({ me, value, onChange }: { me: Me; value: number[]; onChange: (ids: number[]) => void }) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  return (
    <fieldset className="checks" aria-label="Каким врачам помогает">
      <legend>Каким врачам помогает</legend>
      {doctors.map((d) => (
        <label key={d.id} className="check">
          <input type="checkbox" checked={value.includes(d.id!)}
            onChange={(e) => onChange(e.target.checked ? [...value, d.id!] : value.filter((x) => x !== d.id))} /> {d.fullName}
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
    mutationFn: () => unwrap(api.PUT('/api/members/{telegramId}/doctors', { params: { path: { telegramId: member.telegramId! } }, body: { doctorIds: ids } })),
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

/**
 * «Пригласить сотрудника» в «Персонале»: администратора, регистратора или ассистента — ссылкой на бота.
 * Человек нажмёт «Начать» — его Telegram привяжется, и он появится в общем списке. Врачей добавляют
 * кнопкой «+ Добавить врача», приглашение врача — в его карточке.
 */
export function InviteMember({ me }: { me: Me }) {
  const client = useQueryClient()
  const [role, setRole] = useState<Role>('RECEPTION')
  const [name, setName] = useState('')
  const [alsoDoctor, setAlsoDoctor] = useState(false)
  const [doctorIds, setDoctorIds] = useState<number[]>([])
  const [invite, setInvite] = useState<{ token: string; name: string; role: Role } | null>(null)
  const make = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/invite', {
      body: role === 'ASSISTANT' ? { role, fullName: name, doctorIds } : { role, fullName: name, alsoDoctor },
    })),
    onSuccess: (i) => {
      setInvite({ token: i.token ?? '', name: name.trim(), role })
      void client.invalidateQueries({ queryKey: ['member-invites'] })
    },
  })
  const again = () => {
    setInvite(null)
    setName('')
    make.reset()
  }
  return (
    <section className="card-block" id="invite-member">
      <h2>Пригласить сотрудника</h2>
      <p className="hint">Администратор ведёт клинику: врачи, «О клинике», выручка, медкарты. Регистратор записывает пациентов ко всем врачам
        и отмечает оплату, но не видит медкарт и выручки. Ассистент помогает своим врачам: ведёт их расписание, смотрит медкарту
        их пациентов и загружает снимки; денег и настроек не видит.</p>
      {invite ? (
        <>
          <InviteLink start={`staff_${invite.token}`} name={invite.name}
            toWhom={invite.role === 'ADMIN' ? 'администратору' : invite.role === 'ASSISTANT' ? 'ассистенту' : 'регистратору'} />
          <button type="button" className="btn ghost" onClick={again}>Пригласить ещё</button>
        </>
      ) : (
        <form className="form narrow" aria-label="Пригласить сотрудника" onSubmit={(e) => { e.preventDefault(); make.mutate() }}>
          <label className="field"><span>Имя (видно в списке персонала)</span>
            <input value={name} required maxLength={100} placeholder="Например: Айпери" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="segments" role="group" aria-label="Роль">
            {(['RECEPTION', 'ASSISTANT', 'ADMIN'] as const).map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_TEXT[r]}</button>
            ))}
          </div>
          {role === 'ASSISTANT' ? <DoctorChecks me={me} value={doctorIds} onChange={setDoctorIds} />
            : <label className="check"><input type="checkbox" checked={alsoDoctor} onChange={(e) => setAlsoDoctor(e.target.checked)} /> Тоже ведёт приём — станет и врачом</label>}
          {make.error && <p className="error" role="alert">{make.error.fieldErrors.fullName ?? make.error.fieldErrors.doctorIds ?? make.error.message}</p>}
          <button type="submit" className="btn primary" disabled={make.isPending}>Создать ссылку</button>
        </form>
      )}
    </section>
  )
}
