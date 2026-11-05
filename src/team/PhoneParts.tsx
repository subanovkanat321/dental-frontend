import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { PasswordInput, ShowPassword } from '../layout/PasswordFields'
import { notify } from '../lib/confirm'
import { phoneText, ROLE_TEXT } from './texts'

type Role = NonNullable<Schemas['StaffMembersControllerPhoneInviteRequest']['role']>
type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']

/**
 * «Пригласить по номеру (без Telegram)» в «Персонале»: номер, имя и роль — сотрудник сразу в списке.
 * Входит на сайте по номеру: первый раз — код из SMS и свой пароль, дальше — номер и пароль.
 */
export function InviteByPhone({ me }: { me: Me }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('RECEPTION')
  const [alsoDoctor, setAlsoDoctor] = useState(false)
  const [doctorIds, setDoctorIds] = useState<number[]>([])
  const [done, setDone] = useState('')
  const make = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/invite-phone', {
      body: role === 'ASSISTANT'
        ? { phone: phoneFromInput(phone), role, fullName: name, doctorIds }
        : { phone: phoneFromInput(phone), role, fullName: name, alsoDoctor },
    })),
    onSuccess: () => {
      setDone(name.trim())
      setPhone('')
      setName('')
      void client.invalidateQueries({ queryKey: ['members'] })
      void client.invalidateQueries({ queryKey: ['doctors-admin'] })
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  return (
    <section className="card-block" id="invite-phone">
      <h2>Пригласить по номеру</h2>
      <p className="hint">Для тех, у кого нет Telegram. Человек входит на сайте по номеру: первый раз — код из SMS, потом придумывает пароль.
        SMS не приходят — задайте ему «Временный пароль» в строке персонала.
        Уведомления ему приходят в приложение, если он их включит («Настройки → Уведомления»).</p>
      {done && !open && <p className="tone-ok" role="status">{done} — в персонале. Скажите ему открыть сайт и войти по номеру.</p>}
      {!open ? (
        <button type="button" className="btn" onClick={() => { make.reset(); setDone(''); setOpen(true) }}>Пригласить по номеру</button>
      ) : (
        <form className="form narrow" aria-label="Пригласить по номеру" onSubmit={(e) => { e.preventDefault(); make.mutate(undefined, { onSuccess: () => setOpen(false) }) }}>
          <label className="field"><span>Номер телефона</span>
            <PhoneInput label="Номер телефона сотрудника" value={phone} onChange={setPhone} />
          </label>
          {make.error?.fieldErrors.phone && <p className="error">{make.error.fieldErrors.phone}</p>}
          <label className="field"><span>Имя (видно в списке персонала)</span>
            <input value={name} required maxLength={100} placeholder="Например: Айпери" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="segments" role="group" aria-label="Роль по номеру">
            {(['RECEPTION', 'ASSISTANT', 'ADMIN'] as const).map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_TEXT[r]}</button>
            ))}
          </div>
          {role === 'ASSISTANT' ? (
            <fieldset className="checks" aria-label="Каким врачам помогает">
              <legend>Каким врачам помогает</legend>
              {doctors.map((d) => (
                <label key={d.id} className="check">
                  <input type="checkbox" checked={doctorIds.includes(d.id!)}
                    onChange={(e) => setDoctorIds(e.target.checked ? [...doctorIds, d.id!] : doctorIds.filter((x) => x !== d.id))} /> {d.fullName}
                </label>
              ))}
            </fieldset>
          ) : <label className="check"><input type="checkbox" checked={alsoDoctor} onChange={(e) => setAlsoDoctor(e.target.checked)} /> Тоже ведёт приём — станет и врачом</label>}
          {make.error && !make.error.fieldErrors.phone && (
            <p className="error" role="alert">{make.error.fieldErrors.fullName ?? make.error.fieldErrors.doctorIds ?? make.error.message}</p>
          )}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={make.isPending || !phone.trim()}>Добавить</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * «Вход врача» в карточке: врач без Telegram входит по номеру и SMS. Привязать номер можно, пока у
 * врача нет Telegram (сервер не отбирает вход молча).
 */
export function DoctorPhone({ doctor: d, onDone }: { doctor: Doctor; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const bind = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors/{id}/phone', { params: { path: { id: d.id! } }, body: { phone: phoneFromInput(phone) } })),
    onSuccess: () => {
      setOpen(false)
      onDone()
    },
  })
  if (d.phone) {
    return <p className="hint">Входит по номеру {phoneText(d.phone)} и паролю (первый раз — код из SMS). Уведомления — в приложение, если он их включит.</p>
  }
  if (d.telegramId != null) return null
  if (!open) {
    return <button type="button" className="link" onClick={() => setOpen(true)}>Нет Telegram? Вход по номеру телефона</button>
  }
  return (
    <form className="form" aria-label="Вход врача по номеру" onSubmit={(e) => { e.preventDefault(); bind.mutate() }}>
      <label className="field"><span>Номер телефона врача</span>
        <PhoneInput label="Номер телефона врача" value={phone} onChange={setPhone} />
      </label>
      {bind.error && <p className="error" role="alert">{bind.error.fieldErrors.phone ?? bind.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={bind.isPending || !phone.trim()}>Привязать номер</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  )
}

/**
 * «Временный пароль» сотруднику по номеру — когда SMS не подключены или не доходят. Админ задаёт
 * пароль и говорит его лично; сотрудник входит им один раз и сразу придумывает свой (3 дня).
 * Пароль сервер в ответе не возвращает и в журнал действий не пишет.
 */
export function TemporaryPassword({ telegramId, name }: { telegramId: number; name: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(true)
  const set = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/members/{telegramId}/temporary-password', {
      params: { path: { telegramId } }, body: { password },
    })),
    onSuccess: () => {
      setOpen(false)
      setPassword('')
      void notify(`Временный пароль для «${name}» задан. Скажите его лично (не пересылайте в общий чат): при входе `
        + 'по номеру и этому паролю сотрудник сразу придумает свой. Действует 3 дня.')
    },
  })
  if (!open) {
    return <button type="button" className="btn small ghost" onClick={() => { set.reset(); setOpen(true) }}>Временный пароль</button>
  }
  return (
    <form className="form" aria-label={`Временный пароль: ${name}`} onSubmit={(e) => { e.preventDefault(); set.mutate() }}>
      <PasswordInput label="Временный пароль" value={password} onChange={setPassword} shown={shown} autoComplete="new-password" autoFocus />
      <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
      <p className="hint">Не короче 8 символов, не только цифры. Старые входы сотрудника закроются.</p>
      {set.error && <p className="error" role="alert">{set.error.fieldErrors.password ?? set.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={set.isPending || !password}>Задать</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  )
}
