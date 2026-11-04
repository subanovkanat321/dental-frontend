import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { AssistantDoctors, ChangeRole, InviteMember } from './MemberParts'
import { InviteByPhone } from './PhoneParts'
import { phoneText, ROLE_TEXT } from './texts'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']
type Member = Schemas['StaffMembersMemberView']
type Invite = Schemas['StaffMembersInviteView']

/** Фильтр списка по роли: «Все» — весь персонал одной таблицей. */
type Filter = 'all' | 'DOCTOR' | 'ADMIN' | 'RECEPTION' | 'ASSISTANT'
const FILTERS: [Filter, string][] = [['all', 'Все'], ['DOCTOR', 'Врачи'], ['ADMIN', 'Администраторы'], ['RECEPTION', 'Регистратура'], ['ASSISTANT', 'Ассистенты']]

/**
 * Строка «Персонала»: врач (из «Врачей», роль админа или регистратора — рядом), сотрудник без
 * кресла (админ, регистратура, ассистент) или приглашённый, который ещё не вошёл.
 */
type Row =
  | { kind: 'doctor'; key: string; name: string; roles: Filter[]; doctor: Doctor }
  | { kind: 'member'; key: string; name: string; roles: Filter[]; member: Member }
  | { kind: 'invite'; key: string; name: string; roles: Filter[]; invite: Invite }

const ROLE_CHIP: Record<Exclude<Filter, 'all'>, string> = { DOCTOR: 'Врач', ADMIN: 'Администратор', RECEPTION: 'Регистратура', ASSISTANT: 'Ассистент' }

/**
 * «Персонал»: все, кто работает в клинике, — одной таблицей с ролями рядом с именем и тем, вошёл ли
 * человек (Telegram привязан). Админ видит всех и приглашения без входа; остальные — только врачей
 * (сотрудников и их Telegram отдаёт сервер только админу).
 */
export function StaffTab({ me, doctors, loading, error, opened, onOpen }: {
  me: Me
  doctors: Doctor[]
  loading: boolean
  error: Error | null
  opened: number | 'new' | null
  onOpen: (doctorId: number) => void
}) {
  const client = useQueryClient()
  const admin = Boolean(me.admin)
  const members = useQuery({ queryKey: ['members'], queryFn: () => unwrap(api.GET('/api/members')), enabled: admin })
  const invites = useQuery({ queryKey: ['member-invites'], queryFn: () => unwrap(api.GET('/api/members/invites')), enabled: admin })
  const [filter, setFilter] = useState<Filter>('all')

  const remove = useMutation<unknown, ApiError, Member>({
    mutationFn: (m) => unwrap(api.DELETE('/api/members/{telegramId}', { params: { path: { telegramId: m.telegramId! } } })),
    onSuccess: (_r, m) => {
      // Ушли из администраторов сами — доступы другие: начать заново
      if (m.me) window.location.reload()
      else void client.invalidateQueries({ queryKey: ['members'] })
    },
  })
  const cancel = useMutation<unknown, ApiError, Invite>({
    mutationFn: (i) => unwrap(api.DELETE('/api/members/invites/{id}', { params: { path: { id: i.id! } } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['member-invites'] }),
  })

  const rows: Row[] = [
    ...doctors.map((d): Row => ({
      kind: 'doctor', key: `d${d.id}`, name: d.fullName ?? '', doctor: d,
      roles: ['DOCTOR', ...(d.role ? [d.role as Filter] : [])],
    })),
    // Админ или регистратор, который сам ведёт приём, — уже строкой врача
    ...(members.data ?? []).filter((m) => !m.doctor).map((m): Row => ({
      kind: 'member', key: `m${m.telegramId}`, name: m.fullName || (m.phone ? phoneText(m.phone) : `Telegram ${m.telegramId}`), member: m, roles: [m.role as Filter],
    })),
    ...(invites.data ?? []).map((i): Row => ({
      kind: 'invite', key: `i${i.id}`, name: i.fullName ?? '', invite: i, roles: [i.role as Filter],
    })),
  ]
  const shown = filter === 'all' ? rows : rows.filter((r) => r.roles.includes(filter))
  const count = (f: Filter) => (f === 'all' ? rows.length : rows.filter((r) => r.roles.includes(f)).length)

  return (
    <>
      <section className="card-block">
        <p className="hint">Весь персонал клиники: роль — рядом с именем. «Telegram привязан» — человек вошёл и получает уведомления;
          «ждём входа» — ссылку отправили, но он ещё не нажал «Начать» в боте.</p>
        {admin && (
          <div className="segments wrap" role="group" aria-label="Показать роль">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} · {count(f)}</button>
            ))}
          </div>
        )}
        {(error ?? members.error) && <p className="error">{(error ?? members.error)!.message}</p>}
        {loading || (admin && members.isPending) ? <p className="hint">Загрузка…</p> : shown.length ? (
          <table className="table staff-table" aria-label="Персонал">
            <thead><tr><th>Имя</th><th>Роль</th>{admin && <th>Вход</th>}<th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={r.kind === 'doctor'
                  ? [r.doctor.id === opened ? 'active' : '', r.doctor.active === false ? 'inactive' : ''].join(' ').trim() || undefined
                  : r.kind === 'invite' ? 'inactive' : undefined}>
                  <td>
                    <span className="who">
                      {r.kind === 'doctor' && r.doctor.photoUrl
                        ? <img className="avatar" src={r.doctor.photoUrl} alt="" />
                        : <span className="avatar" aria-hidden="true">{(r.name || '?').slice(0, 1)}</span>}
                      {r.kind === 'doctor' && (me.admin || me.reception || r.doctor.id === me.doctorId)
                        ? <button type="button" className="row-link" onClick={() => onOpen(r.doctor.id!)}>{r.name}</button>
                        : <span className="strong">{r.name}</span>}
                    </span>
                    {r.kind === 'member' && r.member.role === 'ASSISTANT' && <AssistantDoctors me={me} member={r.member} />}
                  </td>
                  <td>
                    <span className="role-chips">
                      {r.roles.map((role) => <span key={role} className={`role-chip role-${role.toLowerCase()}`}>{ROLE_CHIP[role as Exclude<Filter, 'all'>] ?? ROLE_TEXT[role]}</span>)}
                    </span>
                    <span className="hint small"> {[
                      (r.kind === 'doctor' && r.doctor.id === me.doctorId) || (r.kind === 'member' && r.member.me) ? 'это вы' : null,
                      r.kind === 'doctor' && r.doctor.active === false ? 'скрыт' : null,
                    ].filter(Boolean).join(' · ')}</span>
                  </td>
                  {admin && (
                    <td>
                      {r.kind === 'invite'
                        ? r.invite.expired
                          ? <span className="tone-wait">ссылка истекла — нужна новая</span>
                          : <span className="tone-wait">ждём входа · ссылка до {shortDate(r.invite.expiresAt!, true)}</span>
                        : r.kind === 'doctor' && !r.doctor.telegramId
                          ? <span className="tone-wait">не привязан — пригласите в карточке</span>
                          : (r.kind === 'doctor' ? r.doctor.phone : r.member.phone)
                            ? <span className="tone-ok">✓ по SMS · {phoneText(r.kind === 'doctor' ? r.doctor.phone : r.member.phone)}</span>
                            : <span className="tone-ok">✓ Telegram привязан</span>}
                    </td>
                  )}
                  <td className="r">
                    {r.kind === 'member' && <ChangeRole me={me} member={r.member} />}
                    {r.kind === 'member' && (
                      <button type="button" className="btn small ghost" disabled={remove.isPending}
                        onClick={() => void ask(r.member.me ? 'Выйти из администраторов клиники?' : `Убрать «${r.name}» из клиники? Доступ пропадёт сразу; выплаты зарплаты останутся в «Касса → Зарплата» за свои месяцы.`).then((ok) => ok && remove.mutate(r.member))}>
                        {r.member.me ? 'Выйти из администраторов' : 'Убрать'}</button>
                    )}
                    {r.kind === 'invite' && (
                      <button type="button" className="btn small ghost" disabled={cancel.isPending}
                        onClick={() => void ask(`Отменить приглашение «${r.name}»? Ссылка перестанет работать.`).then((ok) => ok && cancel.mutate(r.invite))}>
                        Отменить</button>
                    )}
                    {r.kind === 'doctor' && admin && <button type="button" className="btn small ghost" onClick={() => onOpen(r.doctor.id!)}>Открыть</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="hint">{filter === 'all' ? 'Персонала пока нет.' : 'С этой ролью пока никого.'}</p>}
        {(remove.error ?? cancel.error) && <p className="error" role="alert">{(remove.error ?? cancel.error)!.message}</p>}
      </section>
      {admin && <InviteMember me={me} />}
      {admin && <InviteByPhone me={me} />}
    </>
  )
}
