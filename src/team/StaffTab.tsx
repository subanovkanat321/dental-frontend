import { useState } from 'react'

import type { Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { PHONE_HINT, type Doctor } from './PhoneParts'
import { phoneText, ROLE_TEXT } from './texts'
import { Loading } from '../layout/Loading'
import { ChairBadge } from './ChairBadge'
import { useChairs } from './chairs'
import { EmptyState } from '../layout/EmptyState'
import { SubHelp } from '../layout/PageHead'

type Me = Schemas['BookingViewsMe']
type Member = Schemas['StaffMembersMemberView']
type Invite = Schemas['StaffMembersInviteView']

/** Чья карточка открыта: врача, сотрудника, приглашённого или форма «+ Добавить сотрудника». */
export type Opened = { kind: 'new' } | { kind: 'doctor'; id: number } | { kind: 'member'; telegramId: number } | { kind: 'invite'; id: string }

/** Фильтр списка по роли: «Все» — весь персонал одной таблицей. */
type Filter = 'all' | 'DOCTOR' | 'ADMIN' | 'RECEPTION' | 'ASSISTANT'
const FILTERS: [Filter, string][] = [['all', 'Все'], ['DOCTOR', 'Врачи'], ['ADMIN', 'Руководители'], ['RECEPTION', 'Регистратура'], ['ASSISTANT', 'Ассистенты']]

/**
 * Строка «Персонала» — один человек: врач (роль руководителя или регистратуры — рядом), сотрудник без
 * кресла (в том числе скрытый врач, который остался сотрудником) или приглашённый, который ещё не вошёл.
 */
type Row = {
  key: string
  name: string
  roles: Filter[]
  open: Opened
  doctor?: Doctor
  member?: Member
  invite?: Invite
  /** «это вы», «скрыт», «врач скрыт» */
  notes: string[]
}

const ROLE_CHIP: Record<Exclude<Filter, 'all'>, string> = { DOCTOR: 'Врач', ADMIN: 'Руководитель', RECEPTION: 'Регистратура', ASSISTANT: 'Ассистент' }

/** Один человек — одна строка: врач и его строка сотрудника (тот же Telegram) — вместе. */
function staffRows(me: Me, doctors: Doctor[], members: Member[], invites: Invite[]): Row[] {
  const memberOf = (d: Doctor) => (d.telegramId == null ? undefined : members.find((m) => m.telegramId === d.telegramId))
  return [
    // Скрытый врач, который остался сотрудником, — строкой сотрудника ниже
    ...doctors.filter((d) => d.active !== false || !memberOf(d)).map((d): Row => ({
      key: `d${d.id}`, name: d.fullName ?? '', doctor: d, open: { kind: 'doctor', id: d.id },
      roles: [...(d.active !== false ? ['DOCTOR' as Filter] : []), ...(d.role ? [d.role as Filter] : [])],
      notes: [d.id === me.doctorId ? 'это вы' : null, d.active === false ? 'скрыт' : null].filter((x): x is string => Boolean(x)),
    })),
    ...members.filter((m) => !m.doctor).map((m): Row => {
      const hidden = doctors.find((d) => d.telegramId === m.telegramId)
      return {
        key: `m${m.telegramId}`, name: m.fullName || (m.phone ? phoneText(m.phone) : `Telegram ${m.telegramId}`), member: m,
        open: { kind: 'member', telegramId: m.telegramId }, roles: [m.role as Filter],
        notes: [m.me ? 'это вы' : null, hidden ? 'врач скрыт' : null].filter((x): x is string => Boolean(x)),
      }
    }),
    ...invites.map((i): Row => ({
      key: `i${i.id}`, name: i.fullName ?? '', invite: i, open: { kind: 'invite', id: i.id ?? '' }, roles: [i.role as Filter], notes: [],
    })),
  ]
}

function isOpened(row: Row, opened: Opened | null): boolean {
  if (!opened) return false
  return (opened.kind === 'doctor' && row.doctor?.id === opened.id) || (opened.kind === 'member' && row.member?.telegramId === opened.telegramId)
    || (opened.kind === 'invite' && row.invite?.id === opened.id)
}

/**
 * «Персонал»: все, кто работает в клинике, — одной таблицей с ролями рядом с именем и тем, вошёл ли
 * человек. Нажали на имя — его карточка (одна на человека). Руководитель видит всех и приглашения без
 * входа; остальные — только врачей (сотрудников и их Telegram сервер отдаёт только руководителю).
 */
export function StaffTab({ me, doctors, members, invites, loading, error, opened, onOpen }: {
  me: Me
  doctors: Doctor[]
  members: Member[]
  invites: Invite[]
  loading: boolean
  error: Error | null
  opened: Opened | null
  onOpen: (o: Opened) => void
}) {
  const admin = Boolean(me.admin)
  const [filter, setFilter] = useState<Filter>('all')
  const chairs = useChairs()
  const nameOf = (id: number) => doctors.find((d) => d.id === id)?.fullName ?? ''
  const rows = staffRows(me, doctors, members, invites)
  const shown = filter === 'all' ? rows : rows.filter((r) => r.roles.includes(filter))
  const count = (f: Filter) => (f === 'all' ? rows.length : rows.filter((r) => r.roles.includes(f)).length)
  const canOpen = (r: Row) => admin || (r.doctor != null && (me.reception || r.doctor.id === me.doctorId))

  return (
    <>
      {/* Как читать список — в «?» у названия, а не абзацем на четыре строки */}
      <SubHelp title="Персонал">Весь персонал клиники: роль — рядом с именем. Нажмите на имя — откроется карточка: роли, вход, часы{admin ? ', услуги и кресло врача' : ''}.
        «Telegram привязан» — человек вошёл и получает уведомления; «ждём входа» — ссылку отправили, но он ещё не нажал «Начать» в боте.
        {admin && <> Новый человек — «+ Добавить сотрудника»: имя, роль и вход. {PHONE_HINT}</>}</SubHelp>
      <section className="card-block">
        {admin && (
          <div className="segments wrap" role="group" aria-label="Показать роль">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} · {count(f)}</button>
            ))}
          </div>
        )}
        {error && <p className="error">{error.message}</p>}
        {loading ? <Loading /> : shown.length ? (
          <table className="table staff-table" aria-label="Персонал">
            <thead><tr><th>Имя</th><th>Роль</th>{admin && <th>Вход</th>}{admin && <th>Телефон</th>}<th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={[isOpened(r, opened) ? 'active' : '', r.invite || r.doctor?.active === false ? 'inactive' : ''].join(' ').trim() || undefined}>
                  <td>
                    <span className="who">
                      {r.doctor?.photoUrl
                        ? <img className="avatar" src={r.doctor.photoUrl} alt="" />
                        : <span className="avatar" aria-hidden="true">{(r.name || '?').slice(0, 1)}</span>}
                      {canOpen(r)
                        ? <button type="button" className="row-link" onClick={() => onOpen(r.open)}>{r.name}</button>
                        : <span className="strong">{r.name}</span>}
                    </span>
                    {r.doctor && <ChairBadge chairs={chairs.data} doctorId={r.doctor.id} nameOf={nameOf} />}
                    {r.member?.role === 'ASSISTANT' && (
                      <div className="hint small">Помогает: {(r.member.doctorIds ?? []).map(nameOf).filter(Boolean).join(', ') || '—'}</div>
                    )}
                  </td>
                  <td>
                    <span className="role-chips">
                      {r.roles.map((role) => <span key={role} className={`role-chip role-${role.toLowerCase()}`}>{ROLE_CHIP[role as Exclude<Filter, 'all'>] ?? ROLE_TEXT[role]}</span>)}
                    </span>
                    {r.notes.length > 0 && <span className="hint small"> {r.notes.join(' · ')}</span>}
                  </td>
                  {admin && (
                    <td>
                      {r.invite
                        ? r.invite.expired
                          ? <span className="tone-wait">ссылка истекла — нужна новая</span>
                          : <span className="tone-wait">ждём входа · ссылка до {shortDate(r.invite.expiresAt!, true)}</span>
                        : r.doctor && !r.doctor.telegramId
                          ? <span className="tone-wait">ждём входа — пригласите в карточке</span>
                          : (r.doctor ? r.doctor.phoneOnly : r.member?.phoneOnly)
                            ? <span className="tone-ok">✓ по номеру</span>
                            : <span className="tone-ok">✓ Telegram привязан</span>}
                    </td>
                  )}
                  {admin && <td className="staff-phone">{(r.doctor?.phone ?? r.member?.phone) ? phoneText((r.doctor?.phone ?? r.member?.phone)!) : ''}</td>}
                  <td className="r">
                    {canOpen(r) && <button type="button" className="btn small ghost" onClick={() => onOpen(r.open)}>Открыть</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState title={filter === 'all' ? 'Персонала пока нет' : 'С этой ролью пока никого'} />}
      </section>
    </>
  )
}
