import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { Select } from '../layout/Select'
import { phoneFromInput } from '../clinic/phone'
import { useClose } from '../lib/useClose'
import { InviteLink } from './InviteLink'
import { DoctorChecks } from './MemberParts'
import { RoleSelect } from './RoleSelect'
import { rolesOf, type RoleChoice, useRefreshStaff } from './staffRoles'
import { useChairs } from './chairs'

type Me = Schemas['BookingViewsMe']
type Role = NonNullable<Schemas['StaffControllerAddRequest']['role']>
type Login = NonNullable<Schemas['StaffControllerAddRequest']['login']>
type Added = Schemas['StaffRolesAdded']

const LOGINS: [Login, string, string][] = [
  ['LINK', 'Ссылка в Telegram', 'Пришлёте ссылку — человек откроет её и войдёт через Telegram (или по номеру, если Telegram нет)'],
  ['PHONE', 'Номер телефона', 'Без Telegram: входит на сайте по номеру и паролю — первый раз временный пароль от вас («Логин и пароль») или код на почту'],
  ['LATER', 'Позже', 'Добавить сейчас, а ссылку или номер — потом, в его карточке'],
]

/** Кому ссылка — для подписи «Отправьте её врачу». */
/** Значение «＋ Новое кресло» в списке кресел формы. */
const NEW_CHAIR = 'new'

const TO_WHOM: Record<Role, string> = { DOCTOR: 'врачу', ADMIN: 'руководителю', RECEPTION: 'регистратору', ASSISTANT: 'ассистенту' }

/** Куда перейти после «Добавить»: карточка врача, сотрудника или приглашения. */
export type AddedTarget = { kind: 'doctor'; id: number } | { kind: 'member'; telegramId: number } | { kind: 'invite'; id: string }

/**
 * «+ Добавить сотрудника» — одна форма вместо четырёх (2026-11-13): имя → роль → вход. Роль — один список
 * допустимых сочетаний ({@link RoleSelect}: «Руководитель и врач», «Регистратура и врач» → alsoDoctor), у
 * ассистента — его врачи (хотя бы один). Вход —
 * ссылка в Telegram, номер телефона или «позже». Сервер раскладывает по прежним путям (POST /api/staff):
 * врач — карточка врача и ссылка join_, остальные — приглашение staff_ или вход по номеру.
 */
export function AddStaffPanel({ me, onClose, onAdded }: { me: Me; onClose: () => void; onAdded: (target: AddedTarget) => void }) {
  const close = useClose(onClose)
  const refresh = useRefreshStaff()
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [choice, setChoice] = useState<RoleChoice>('DOCTOR')
  const [doctorIds, setDoctorIds] = useState<number[]>([])
  const [login, setLogin] = useState<Login>('LINK')
  const [phone, setPhone] = useState('')
  const [link, setLink] = useState<{ added: Added; name: string; role: Role } | null>(null)
  const picked = rolesOf(choice)
  // Только врач — role DOCTOR; руководитель или регистратура «и врач» — alsoDoctor
  const role: Role = picked.role ?? 'DOCTOR'
  const isDoctor = role === 'DOCTOR' || ((role === 'ADMIN' || role === 'RECEPTION') && Boolean(picked.doctor))
  // Кресло врача сразу при добавлении (2026-11-20, просьба владельца): новое — с готовым названием «Кресло N»,
  // или к существующему (врачи одного кресла не примут двух пациентов в одно время), или без кресла
  const chairs = useChairs(isDoctor)
  const [chair, setChair] = useState<string>(NEW_CHAIR)
  const [chairName, setChairName] = useState('')
  const [chairWarning, setChairWarning] = useState('')
  const defaultChairName = `Кресло ${(chairs.data?.length ?? 0) + 1}`
  const nameOf = (id: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? ''
  const add = useMutation<Added, ApiError>({
    mutationFn: async () => {
      const added = await unwrap(api.POST('/api/staff', {
        body: {
          fullName: name, role, login,
          alsoDoctor: role === 'ADMIN' || role === 'RECEPTION' ? picked.doctor : undefined,
          doctorIds: role === 'ASSISTANT' ? doctorIds : undefined,
          phone: login === 'PHONE' ? phoneFromInput(phone) : undefined,
        },
      }))
      if (isDoctor && added.doctorId != null && chair) {
        // Сотрудник уже добавлен: не вышло с креслом — не ошибка формы, а подсказка (кресло можно выбрать в карточке)
        try {
          const chairId = chair === NEW_CHAIR
            ? (await unwrap(api.POST('/api/chairs', { body: { name: chairName.trim() || defaultChairName } }))).id
            : Number(chair)
          await unwrap(api.PUT('/api/doctors/{id}/chair', { params: { path: { id: added.doctorId } }, body: { chairId } }))
        }
        catch (e) {
          setChairWarning(`Кресло не назначено: ${e instanceof ApiError ? e.message : 'ошибка'}. Выберите его в карточке врача.`)
        }
      }
      return added
    },
    onSuccess: (added) => {
      refresh()
      void client.invalidateQueries({ queryKey: ['chairs'] })
      if (added.start && login === 'LINK') setLink({ added, name: name.trim(), role })
      else onAdded(targetOf(added))
    },
  })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)

  if (link) {
    return (
      <aside className="panel" aria-label="Сотрудник добавлен">
        <header className="panel-head">
          <h2>{link.name}</h2>
          <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
        </header>
        <p className="tone-ok" role="status">Добавлено. Осталось отправить ссылку.</p>
        {chairWarning && <p className="tone-wait" role="note">{chairWarning}</p>}
        <InviteLink start={link.added.start!} name={link.name} toWhom={TO_WHOM[link.role]} />
        <div className="actions">
          <button type="button" className="btn" onClick={() => onAdded(targetOf(link.added))}>Открыть карточку</button>
        </div>
      </aside>
    )
  }

  const error = add.error
  return (
    <aside className="panel" aria-label="Новый сотрудник">
      <header className="panel-head">
        <h2>Новый сотрудник</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <form className="form" aria-label="Добавить сотрудника" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
        <label className="field"><span>Имя</span>
          <input value={name} required maxLength={100} autoFocus placeholder="Например: Айгерим Садыкова"
            onChange={(e) => { add.reset(); setName(e.target.value) }} />
          <span className="hint small">Черновик — человек потом поправит сам</span>
        </label>
        {error?.fieldErrors.fullName && <p className="error">{error.fieldErrors.fullName}</p>}

        <label className="field"><span>Роль</span>
          <RoleSelect value={choice} onChange={(c) => { add.reset(); setChoice(c) }} />
        </label>
        {role === 'ASSISTANT' && (doctors.length
          ? <DoctorChecks me={me} value={doctorIds} onChange={setDoctorIds} />
          : <p className="hint">Сначала добавьте врача: ассистент помогает своим врачам.</p>)}
        {error?.fieldErrors.doctorIds && <p className="error">{error.fieldErrors.doctorIds}</p>}
        {isDoctor && (
          <div className="field"><span>Кресло</span>
            <Select aria-label="Кресло" value={chair} disabled={chairs.isPending} onChange={(e) => { add.reset(); setChair(e.target.value) }}>
              <option value={NEW_CHAIR}>＋ Новое кресло</option>
              {(chairs.data ?? []).map((c) => {
                const who = (c.doctorIds ?? []).map(nameOf).filter(Boolean).join(', ')
                return <option key={c.id} value={c.id}>{c.name}{who ? ` · ${who}` : ''}</option>
              })}
              <option value="">— без кресла —</option>
            </Select>
            {chair === NEW_CHAIR && (
              <input aria-label="Название кресла" value={chairName} maxLength={40} placeholder={defaultChairName}
                onChange={(e) => { add.reset(); setChairName(e.target.value) }} />
            )}
            <span className="hint small">{chair === NEW_CHAIR ? 'Своё кресло врача' : chair ? 'Общее кресло: двух пациентов на одно время не запишем' : 'Можно выбрать потом, в карточке врача'}</span>
          </div>
        )}

        <div className="field"><span>Вход</span>
          <div className="segments wrap" role="group" aria-label="Вход">
            {LOGINS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={login === value} onClick={() => { add.reset(); setLogin(value) }}>{label}</button>
            ))}
          </div>
          <span className="hint small">{LOGINS.find(([value]) => value === login)![2]}</span>
        </div>
        {login === 'PHONE' && (
          <label className="field"><span>Номер телефона</span>
            <PhoneInput label="Номер телефона сотрудника" value={phone} onChange={(v) => { add.reset(); setPhone(v) }} />
          </label>
        )}
        {error?.fieldErrors.phone && <p className="error">{error.fieldErrors.phone}</p>}
        {error && !error.fieldErrors.fullName && !error.fieldErrors.doctorIds && !error.fieldErrors.phone && (
          <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>
        )}
        <button type="submit" className="btn primary" disabled={add.isPending || (login === 'PHONE' && !phone.trim())
          || (role === 'ASSISTANT' && !doctorIds.length)}>Добавить</button>
      </form>
    </aside>
  )
}

function targetOf(added: Added): AddedTarget {
  if (added.doctorId != null) return { kind: 'doctor', id: added.doctorId }
  if (added.telegramId != null) return { kind: 'member', telegramId: added.telegramId }
  return { kind: 'invite', id: added.inviteId ?? '' }
}
