import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { useUnsaved } from '../lib/unsaved'
import { DoctorChecks } from './MemberParts'
import { RoleSelect } from './RoleSelect'
import { choiceOf, rolesOf, useRefreshStaff } from './staffRoles'

type Me = Schemas['BookingViewsMe']
type StaffRole = NonNullable<Schemas['StaffControllerRolesRequest']['role']>

/**
 * «Роль» в карточке человека (только руководитель): один список допустимых сочетаний ({@link RoleSelect}) —
 * Врач, Руководитель, Руководитель и врач, Регистратура, Регистратура и врач, Ассистент (+ «Врач скрыт» у
 * врача без роли в клинике). Пункт без «врача» у работающего врача — врач скрывается (история и расписание
 * остаются), с подтверждением. Роль в клинике — тому, кто вошёл (Telegram или номер). Себе — тот же список. Правила проверяет и сервер
 * (PUT /api/staff/roles): последний руководитель — 409, ассистент + врач — 422.
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
  /** Вошёл (Telegram или номер): без входа роль в клинике не дать */
  hasLogin: boolean
  name: string
}) {
  const refresh = useRefreshStaff()
  const initial = choiceOf(doctor, role)
  const [choice, setChoice] = useState(initial)
  const [ids, setIds] = useState<number[]>(doctorIds ?? [])
  const picked = rolesOf(choice)
  const sorted = (list: number[]) => [...list].sort((a, b) => a - b).join()
  const dirty = choice !== initial || (picked.role === 'ASSISTANT' && sorted(ids) !== sorted(doctorIds ?? []))
  useUnsaved(dirty)
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/staff/roles', {
      body: {
        doctorId: doctorId ?? undefined, telegramId: telegramId ?? undefined, doctor: picked.doctor,
        role: picked.role ?? undefined, doctorIds: picked.role === 'ASSISTANT' ? ids : undefined,
      },
    })),
    onSuccess: () => {
      // Свои права поменялись — меню и доступы другие: проще начать заново
      if (self) window.location.reload()
      else refresh()
    },
  })
  const submit = async () => {
    if (doctor && !picked.doctor && !await ask(`Снять роль «Врач» у «${name}»? Врач скроется: пациенты его не увидят и не запишутся, вход врачом `
      + 'закроется. Расписание, приёмы, выручка и история останутся — роль можно вернуть.', { ok: 'Снять «Врач»', danger: true })) return
    if (self && role === 'ADMIN' && picked.role !== 'ADMIN'
      && !await ask('Вы перестанете быть руководителем: «Персонал», деньги и настройки станут недоступны. Продолжить?', { ok: 'Продолжить', danger: true })) return
    save.mutate()
  }
  // Роль в клинике — только тому, кто вошёл (у кого её ещё нет)
  const noLogin = !hasLogin && role == null
  return (
    <form className="form roles-editor" aria-label="Роли" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {/* Без подписи «Роль»: над полем уже заголовок раздела «Роли» (имя поля — aria-label) */}
      <RoleSelect value={choice} hideable={doctorId != null && role == null} isDisabled={(c) => noLogin && rolesOf(c).role != null}
        onChange={(c) => { save.reset(); setChoice(c) }} />
      {picked.role === 'ASSISTANT' && <DoctorChecks me={me} value={ids} onChange={setIds} />}
      {noLogin && <p className="hint small">Руководителя, регистратуру и ассистента назначают тому, кто вошёл: сначала пригласите по ссылке или номеру.</p>}
      {/* Последний руководитель — 409 с понятным текстом сервера: «Это единственный руководитель клиники: сначала назначьте другого» */}
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.role ?? save.error.fieldErrors.doctorIds ?? save.error.message}</p>}
      {dirty && (
        <div className="actions">
          <button type="submit" className="btn primary" disabled={save.isPending || (picked.role === 'ASSISTANT' && !ids.length)}>Сохранить роль</button>
          <button type="button" className="btn ghost" onClick={() => { save.reset(); setChoice(initial); setIds(doctorIds ?? []) }}>Отмена</button>
        </div>
      )}
    </form>
  )
}
