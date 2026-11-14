import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { PHONE_HINT, type Doctor } from './PhoneParts'
import { phoneText, ROLE_TEXT } from './texts'
import { Segments } from '../layout/Segments'
import { Loading } from '../layout/Loading'
import { ChairBadge } from './ChairBadge'
import { useChairs } from './chairs'
import { EmptyState } from '../layout/EmptyState'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'
import { useMedia } from '../lib/useMedia'
import { useTimeOff, weeklyDaysOff } from './dayOffHours'
import { dayHours, loadWeek, weekKey, weekSummary, type Who } from './workWeek'
import './cards.css'
import './staff.css'

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
 * «Персонал»: все, кто работает в клинике, — одним списком во всю рабочую область (и при открытой карточке
 * справа — на оставшуюся ширину). Шапка карточки — «Персонал · N», фильтр ролей и «＋ Добавить сотрудника»
 * справа. Строка — одна строка смысла: имя, роль серым, кресло и часы мелко, вход и телефон; нажимается
 * вся строка. На телефоне — список: имя и роль, ниже мелко кресло и вход. Руководитель видит всех и
 * приглашения без входа; остальные — только врачей (сотрудников и их Telegram сервер отдаёт только руководителю).
 */
export function StaffTab({ me, doctors, members, invites, loading, error, opened, onOpen, onAdd }: {
  me: Me
  doctors: Doctor[]
  members: Member[]
  invites: Invite[]
  loading: boolean
  error: Error | null
  opened: Opened | null
  onOpen: (o: Opened) => void
  /** «＋ Добавить сотрудника» (руководитель) */
  onAdd?: () => void
}) {
  const admin = Boolean(me.admin)
  const [filter, setFilter] = useState<Filter>('all')
  const phone = useMedia('(max-width: 760px)')
  const chairs = useChairs()
  const nameOf = (id: number) => doctors.find((d) => d.id === id)?.fullName ?? ''
  const rows = staffRows(me, doctors, members, invites)
  const shown = filter === 'all' ? rows : rows.filter((r) => r.roles.includes(filter))
  const count = (f: Filter) => (f === 'all' ? rows.length : rows.filter((r) => r.roles.includes(f)).length)
  const canOpen = (r: Row) => admin || (r.doctor != null && (me.reception || r.doctor.id === me.doctorId))
  // Часы — у тех, чью неделю видно в «Рабочем времени»: руководитель и регистратура (врачей)
  const showHours = admin || Boolean(me.reception)
  const add = onAdd && <button type="button" className="btn primary small" onClick={onAdd}>＋ Добавить сотрудника</button>
  // Есть что показать: загрузилось без ошибки и не пусто — тогда в шапке число и фильтр ролей
  const listed = !error && !loading && rows.length > 0
  const roleText = (r: Row) => [...r.roles.map((role) => ROLE_CHIP[role as Exclude<Filter, 'all'>] ?? ROLE_TEXT[role]).map((t, i) => (i ? t.toLowerCase() : t)), ...r.notes].join(' · ')

  const body = error ? <p className="error" role="alert">Не загрузился персонал: {error.message}</p>
    : loading ? <Loading />
      : !shown.length ? (
        filter === 'all'
          ? <EmptyState title="Персонала пока нет" action={add}>Добавьте врачей, регистратуру и ассистентов — у каждого будет своя карточка и вход.</EmptyState>
          : <EmptyState title="С этой ролью пока никого" />
      ) : phone ? (
        <ul className="staff-lines" aria-label="Персонал">
          {shown.map((r) => (
            <li key={r.key} {...rowOpen(canOpen(r) && (() => onOpen(r.open)), 'staff-line', isOpened(r, opened) && 'active', (r.invite || r.doctor?.active === false) && 'inactive')}>
              <Avatar row={r} />
              <span className="staff-line-text">
                <span className="staff-line-name">
                  {canOpen(r) ? <button type="button" className="row-link" onClick={() => onOpen(r.open)}>{r.name}</button> : <span className="strong">{r.name}</span>}
                  <span className="hint small">{roleText(r)}</span>
                </span>
                <span className="staff-line-meta">
                  {r.doctor && <ChairBadge chairs={chairs.data} doctorId={r.doctor.id} nameOf={nameOf} />}
                  {admin && <Access row={r} />}
                </span>
              </span>
              {canOpen(r) && <span className="staff-chev" aria-hidden="true">›</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="staff-scroll">
          <table className="table staff-table" aria-label="Персонал">
            <thead>
              <tr><th>Имя</th><th>Кресло</th>{showHours && <th>Часы</th>}{admin && <th>Вход</th>}{admin && <th className="staff-phone">Телефон</th>}<th className="staff-chev" aria-hidden="true" /></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} {...rowOpen(canOpen(r) && (() => onOpen(r.open)), isOpened(r, opened) && 'active', (r.invite || r.doctor?.active === false) && 'inactive')}>
                  <td>
                    <span className="who">
                      <Avatar row={r} />
                      <span className="who-text">
                        {canOpen(r)
                          ? <button type="button" className="row-link" onClick={() => onOpen(r.open)}>{r.name}</button>
                          : <span className="strong">{r.name}</span>}
                        <span className="hint small">{roleText(r)}</span>
                      </span>
                    </span>
                  </td>
                  <td className="staff-small">
                    {r.doctor ? <ChairBadge chairs={chairs.data} doctorId={r.doctor.id} nameOf={nameOf} />
                      : r.member?.role === 'ASSISTANT'
                        ? <span className="hint">Помогает: {(r.member.doctorIds ?? []).map(nameOf).filter(Boolean).join(', ') || '—'}</span> : null}
                  </td>
                  {showHours && <td className="staff-small num"><RowHours row={r} /></td>}
                  {admin && <td className="staff-small"><Access row={r} /></td>}
                  {admin && <td className="staff-phone num">{(r.doctor?.phone ?? r.member?.phone) ? phoneText((r.doctor?.phone ?? r.member?.phone)!) : ''}</td>}
                  <td className="staff-chev" aria-hidden="true">{canOpen(r) ? '›' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

  return (
    <>
      {/* Как читать список — в «?» у названия раздела, а не абзацем на четыре строки */}
      <SubHelp title="Персонал">Весь персонал клиники: роль — серым под именем. Нажмите на строку — откроется карточка: роли, вход, часы{admin ? ', услуги и кресло врача' : ''}.
        «Telegram привязан» — человек вошёл и получает уведомления; «ждём входа» — ссылку отправили, но он ещё не нажал «Начать» в боте.
        {admin && <> Новый человек — «＋ Добавить сотрудника»: имя, роль и вход. {PHONE_HINT}</>}</SubHelp>
      <section className="card-block staff-list">
        <div className="card-title-line staff-head">
          <h2>Персонал{listed ? <span className="hint"> · {rows.length}</span> : null}</h2>
          {admin && listed && (
            <Segments className="staff-filter" label="Показать роль" value={filter} onChange={setFilter}
              options={FILTERS.filter(([f]) => f === 'all' || count(f) > 0).map(([f, label]) => ({ value: f, label: f === 'all' ? label : `${label} · ${count(f)}`, text: `${label} · ${count(f)}` }))} />
          )}
          {/* Пустой список — кнопка в пустом состоянии, а не две одинаковые */}
          {add && (listed || error) && <span className="card-title-end">{add}</span>}
        </div>
        {body}
      </section>
    </>
  )
}

function Avatar({ row: r }: { row: Row }) {
  return r.doctor?.photoUrl
    ? <img className="avatar" src={r.doctor.photoUrl} alt="" />
    : <span className="avatar" aria-hidden="true">{(r.name || '?').slice(0, 1)}</span>
}

/** Вошёл ли человек: Telegram, номер или «ждём входа». */
function Access({ row: r }: { row: Row }) {
  if (r.invite) {
    return r.invite.expired
      ? <span className="tone-wait">ссылка истекла — нужна новая</span>
      : <span className="tone-wait">ждём входа · ссылка до {shortDate(r.invite.expiresAt!, true)}</span>
  }
  if (r.doctor && !r.doctor.telegramId) return <span className="tone-wait">ждём входа — пригласите в карточке</span>
  return (r.doctor ? r.doctor.phoneOnly : r.member?.phoneOnly)
    ? <span className="tone-ok">✓ по номеру</span>
    : <span className="tone-ok">✓ Telegram привязан</span>
}

/** Обычная неделя человека строкой: «Пн–Пт 9–18»; «как у клиники» — серым курсивом (как в «Рабочем времени»). */
function RowHours({ row: r }: { row: Row }) {
  const who: Who | null = r.doctor && r.doctor.active !== false ? { kind: 'doctor', id: r.doctor.id, name: r.name }
    : r.member ? { kind: 'staff', telegramId: r.member.telegramId, name: r.name } : null
  const week = useQuery({ queryKey: who ? weekKey(who) : ['no-week'], queryFn: () => loadWeek(who!), enabled: who != null })
  const off = weeklyDaysOff(useTimeOff().data, who?.kind === 'doctor' ? who.id : null)
  if (!who) return null
  if (!week.data) return <span className="hint">{week.error ? '—' : '…'}</span>
  if (!week.data.custom) return <span className="staff-by-clinic">как у клиники</span>
  return <>{weekSummary(dayHours(week.data.days, who.kind === 'doctor' ? off : {}))}</>
}
