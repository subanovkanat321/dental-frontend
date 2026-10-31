import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { InviteLink } from './InviteLink'
import { ROLE_TEXT } from './texts'

type Role = NonNullable<Schemas['StaffMembersControllerInviteRequest']['role']>

/**
 * «Сотрудники»: администраторы и регистратура клиники; пригласить ссылкой на бота, убрать.
 * Врачи — во вкладке «Врачи». Только админ.
 */
export function MembersTab() {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['members'], queryFn: () => unwrap(api.GET('/api/members')) })
  const [role, setRole] = useState<Role>('RECEPTION')
  const [name, setName] = useState('')
  const [alsoDoctor, setAlsoDoctor] = useState(false)
  const [invite, setInvite] = useState<{ token: string; name: string; role: Role } | null>(null)
  const make = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/invite', { body: { role, fullName: name, alsoDoctor } })),
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
          и отмечает оплату, но не видит медкарт и выручки.</p>
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <p className="hint">Загрузка…</p> : list.data?.length ? (
          <table className="table" aria-label="Сотрудники">
            <thead><tr><th>Сотрудник</th><th>Роль</th><th /></tr></thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.telegramId}>
                  <td className="strong">{m.fullName || `Telegram ${m.telegramId}`}</td>
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
            <InviteLink start={`staff_${invite.token}`} name={invite.name} toWhom={invite.role === 'ADMIN' ? 'администратору' : 'регистратору'} />
            <button type="button" className="btn ghost" onClick={again}>Пригласить ещё</button>
          </>
        ) : (
          <form className="form narrow" aria-label="Пригласить сотрудника" onSubmit={(e) => { e.preventDefault(); make.mutate() }}>
            <label className="field"><span>Имя (видно в этом списке)</span>
              <input value={name} required maxLength={100} placeholder="Например: Айпери (регистратура)" onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="segments" role="group" aria-label="Роль">
              {(['RECEPTION', 'ADMIN'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_TEXT[r]}</button>
              ))}
            </div>
            <label className="check"><input type="checkbox" checked={alsoDoctor} onChange={(e) => setAlsoDoctor(e.target.checked)} /> Тоже ведёт приём — станет и врачом</label>
            {make.error && <p className="error" role="alert">{make.error.fieldErrors.fullName ?? make.error.message}</p>}
            <button type="submit" className="btn primary" disabled={make.isPending}>Создать ссылку</button>
          </form>
        )}
      </section>
    </>
  )
}
