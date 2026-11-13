import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { useUnsaved } from '../lib/unsaved'
import { DoctorChecks } from './MemberParts'
import { ROLE_HINT, ROLES_RULES, useRefreshStaff } from './staffRoles'

type Me = Schemas['BookingViewsMe']
type StaffRole = NonNullable<Schemas['StaffControllerRolesRequest']['role']>

/** Роли без «Врач» — одна из трёх (или ни одной у врача). */
const STAFF_ROLES: [StaffRole | null, string][] = [[null, 'Нет'], ['ADMIN', 'Руководитель'], ['RECEPTION', 'Регистратура'], ['ASSISTANT', 'Ассистент']]

/**
 * «Роли» в карточке человека (только руководитель): флажок «Врач» и роль сотрудника — Руководитель,
 * Регистратура или Ассистент. Снять «Врач» у врача — он скрывается (история и расписание остаются),
 * с подтверждением. Роль сотрудника — тому, кто вошёл (Telegram или номер). Себе «Врач» — «Веду приём».
 * Правила проверяет и сервер (PUT /api/staff/roles): последний руководитель, ассистент + врач — 422.
 */
export function RolesEditor({ me, doctorId, telegramId, doctor, role, doctorIds, self, hasLogin, name }: {
  me: Me
  doctorId?: number | null
  telegramId?: number | null
  /** Работающий врач сейчас */
  doctor: boolean
  role: StaffRole | null
  doctorIds?: number[]
  self: boolean
  /** Вошёл (Telegram или номер): без входа роль сотрудника не дать */
  hasLogin: boolean
  name: string
}) {
  const refresh = useRefreshStaff()
  const [isDoctor, setDoctor] = useState(doctor)
  const [staffRole, setRole] = useState<StaffRole | null>(role)
  const [ids, setIds] = useState<number[]>(doctorIds ?? [])
  const sorted = (list: number[]) => [...list].sort((a, b) => a - b).join()
  const dirty = isDoctor !== doctor || staffRole !== role || (staffRole === 'ASSISTANT' && sorted(ids) !== sorted(doctorIds ?? []))
  useUnsaved(dirty)
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/staff/roles', {
      body: {
        doctorId: doctorId ?? undefined, telegramId: telegramId ?? undefined, doctor: isDoctor,
        role: staffRole ?? undefined, doctorIds: staffRole === 'ASSISTANT' ? ids : undefined,
      },
    })),
    onSuccess: () => {
      // Свои права поменялись — меню и доступы другие: проще начать заново
      if (self) window.location.reload()
      else refresh()
    },
  })
  const submit = async () => {
    if (doctor && !isDoctor && !await ask(`Снять роль «Врач» у «${name}»? Врач скроется: пациенты его не увидят и не запишутся, вход врачом `
      + 'закроется. Расписание, приёмы, выручка и история останутся — роль можно вернуть.', { ok: 'Снять «Врач»', danger: true })) return
    if (self && role === 'ADMIN' && staffRole !== 'ADMIN'
      && !await ask('Вы перестанете быть руководителем: «Персонал», деньги и настройки станут недоступны. Продолжить?', { ok: 'Продолжить', danger: true })) return
    save.mutate()
  }
  const doctorLabel = self ? 'Веду приём (врач)' : 'Врач'
  return (
    <form className="form roles-editor" aria-label="Роли" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className="check">
        <input type="checkbox" checked={isDoctor} disabled={staffRole === 'ASSISTANT'}
          onChange={(e) => { save.reset(); setDoctor(e.target.checked) }} />
        <span><strong>{doctorLabel}</strong><span className="hint"> — {ROLE_HINT.DOCTOR}</span></span>
      </label>
      <div className="field"><span>Роль в клинике</span>
        <div className="segments wrap" role="group" aria-label="Роль в клинике">
          {STAFF_ROLES.map(([value, label]) => (
            <button key={label} type="button" aria-pressed={staffRole === value}
              disabled={(value === null && !isDoctor) || (value === 'ASSISTANT' && isDoctor) || (value !== null && !hasLogin && role == null)}
              onClick={() => { save.reset(); setRole(value) }}>{label}</button>
          ))}
        </div>
        {staffRole && <span className="hint small">{ROLE_HINT[staffRole]}</span>}
      </div>
      {staffRole === 'ASSISTANT' && <DoctorChecks me={me} value={ids} onChange={setIds} />}
      <p className="hint small">{ROLES_RULES}{!hasLogin && role == null ? ' Роль в клинике дают тому, кто вошёл: сначала пригласите по ссылке или номеру.' : ''}</p>
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.role ?? save.error.fieldErrors.doctorIds ?? save.error.message}</p>}
      {dirty && (
        <div className="actions">
          <button type="submit" className="btn primary" disabled={save.isPending || (staffRole === 'ASSISTANT' && !ids.length)}>Сохранить роли</button>
          <button type="button" className="btn ghost" onClick={() => { save.reset(); setDoctor(doctor); setRole(role); setIds(doctorIds ?? []) }}>Отмена</button>
        </div>
      )}
    </form>
  )
}
