import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
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
function AssistantDoctors({ me, member }: { me: Me; member: Member }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [ids, setIds] = useState<number[]>(member.doctorIds ?? [])
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
      <div className="hint">Помогает: {names.join(', ') || '—'}{' '}
        <button type="button" className="link" onClick={() => { setIds(member.doctorIds ?? []); setEditing(true) }}>изменить</button></div>
    )
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} aria-label={`Врачи ассистента ${member.fullName ?? ''}`}>
      <DoctorChecks me={me} value={ids} onChange={setIds} />
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.doctorIds ?? save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn small primary" disabled={save.isPending || !ids.length}>Сохранить</button>
        <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Отмена</button>
      </div>
    </form>
  )
}

/**
 * «Сотрудники»: администраторы, регистратура и ассистенты клиники; пригласить ссылкой на бота,
 * убрать. Врачи — во вкладке «Врачи». Только админ.
 */
export function MembersTab({ me }: { me: Me }) {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['members'], queryFn: () => unwrap(api.GET('/api/members')) })
  const [role, setRole] = useState<Role>('RECEPTION')
  const [name, setName] = useState('')
  const [alsoDoctor, setAlsoDoctor] = useState(false)
  const [doctorIds, setDoctorIds] = useState<number[]>([])
  const [invite, setInvite] = useState<{ token: string; name: string; role: Role } | null>(null)
  const make = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/invite', {
      body: role === 'ASSISTANT' ? { role, fullName: name, doctorIds } : { role, fullName: name, alsoDoctor },
    })),
    onSuccess: (i) => setInvite({ token: i.token ?? '', name: name.trim(), role }),
  })
  const remove = useMutation<unknown, ApiError, Schemas['StaffMembersMemberView']>({
    mutationFn: (m) => unwrap(api.DELETE('/api/members/{telegramId}', { params: { path: { telegramId: m.telegramId! } } })),
    onSuccess: (_r, m) => {
      // Ушли из администраторов сами — доступы другие: начать заново
      if (m.me) window.location.reload()
      else void client.invalidateQueries({ queryKey: ['members'] })
    },
  })
  const again = () => {
    setInvite(null)
    setName('')
    make.reset()
  }

  return (
    <>
      <section className="card-block">
        <p className="hint">Администратор ведёт клинику: врачи, «О клинике», выручка, медкарты. Регистратор записывает пациентов ко всем врачам
          и отмечает оплату, но не видит медкарт и выручки. Ассистент помогает своим врачам: ведёт их расписание, смотрит медкарту
          их пациентов и загружает снимки; денег и настроек не видит.</p>
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <p className="hint">Загрузка…</p> : list.data?.length ? (
          <table className="table" aria-label="Сотрудники">
            <thead><tr><th>Сотрудник</th><th>Роль</th><th /></tr></thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.telegramId}>
                  <td className="strong">{m.fullName || `Telegram ${m.telegramId}`}
                    {m.role === 'ASSISTANT' && <AssistantDoctors me={me} member={m} />}</td>
                  <td className="hint">{[ROLE_TEXT[m.role ?? ''], m.doctor ? 'врач' : null, m.me ? 'это вы' : null].filter(Boolean).join(' · ')}</td>
                  <td className="r">
                    <button type="button" className="btn small ghost" disabled={remove.isPending}
                      onClick={() => window.confirm(m.me ? 'Выйти из администраторов клиники?' : `Убрать «${m.fullName ?? m.telegramId}» из клиники?`) && remove.mutate(m)}>
                      {m.me ? 'Выйти из администраторов' : 'Убрать из клиники'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="hint">Сотрудников пока нет.</p>}
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      </section>

      <section className="card-block">
        <h2>Пригласить</h2>
        {invite ? (
          <>
            <InviteLink start={`staff_${invite.token}`} name={invite.name}
              toWhom={invite.role === 'ADMIN' ? 'администратору' : invite.role === 'ASSISTANT' ? 'ассистенту' : 'регистратору'} />
            <button type="button" className="btn ghost" onClick={again}>Пригласить ещё</button>
          </>
        ) : (
          <form className="form narrow" aria-label="Пригласить сотрудника" onSubmit={(e) => { e.preventDefault(); make.mutate() }}>
            <label className="field"><span>Имя (видно в этом списке)</span>
              <input value={name} required maxLength={100} placeholder="Например: Айпери (регистратура)" onChange={(e) => setName(e.target.value)} />
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
    </>
  )
}
