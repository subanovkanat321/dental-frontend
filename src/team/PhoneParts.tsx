import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { HelpHint } from '../help/HelpHint'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { PasswordInput, ShowPassword } from '../layout/PasswordFields'
import { notify } from '../lib/confirm'
import { phoneText } from './texts'

// Админу — DoctorAdminView, остальным — DoctorView из me (без Telegram, роли и телефона)
export type Doctor = Schemas['DoctorAdminView'] | (Schemas['DoctorView'] & Partial<Schemas['DoctorAdminView']>)

/**
 * «Вход врача» в карточке: врач без Telegram входит по номеру и SMS. Привязать номер можно, пока у
 * врача нет Telegram (сервер не отбирает вход молча).
 */
export function DoctorPhone({ doctor: d, onDone }: { doctor: Doctor; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const bind = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors/{id}/phone', { params: { path: { id: d.id } }, body: { phone: phoneFromInput(phone) } })),
    onSuccess: () => {
      setOpen(false)
      onDone()
    },
  })
  // Есть вход (Telegram или номер) — телефон меняют в «Телефоне» (StaffPhone)
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

/** Подсказка у телефона сотрудника — одна в «Персонале» и в «Моём профиле». */
export const PHONE_HINT = 'Номер — для входа на сайте без Telegram: номер и пароль. Первый раз или забыли пароль — код в Telegram или по SMS. С Telegram пароль не нужен: «Войти через Telegram».'

/** Сотруднику с Telegram номер для входа админ не задаёт — только он сам, с кодом из SMS. */
export const SELF_HINT = 'Номер для входа сотрудник указывает сам — в «Моём профиле» (нажать на себя внизу меню).'

/**
 * «Телефон» сотрудника в «Персонале» и карточке врача (админ). У сотрудника без Telegram номер — его
 * вход: админ меняет (`PUT /api/members/{id}/phone`), убрать нельзя. У сотрудника с Telegram — только
 * показать (если задан): номер для входа он указывает сам в «Моём профиле», подтверждая кодом из SMS,
 * иначе админ мог бы вписать свой номер и войти этим человеком.
 */
export function StaffPhone({ telegramId, phone, phoneOnly, name, compact = false }: {
  telegramId: number
  phone?: string | null
  phoneOnly?: boolean
  name?: string
  /** В строке таблицы: номер и маленькая кнопка, без подсказки */
  compact?: boolean
}) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/members/{telegramId}/phone', { params: { path: { telegramId } }, body: { phone: phoneFromInput(value) } })),
    onSuccess: () => {
      setOpen(false)
      void client.invalidateQueries({ queryKey: ['members'] })
      void client.invalidateQueries({ queryKey: ['doctors-admin'] })
    },
  })

  if (!phoneOnly) {
    return compact
      ? <span className="staff-phone" title={SELF_HINT}>{phone ? phoneText(phone) : <span className="hint small">сам в профиле</span>}</span>
      : <p className="hint">{phone ? `Телефон: ${phoneText(phone)}` : 'Телефон указывает сам'} <HelpHint title="Телефон">{SELF_HINT}</HelpHint></p>
  }
  if (!open) {
    return (
      <div className="staff-phone">
        {phone && <span>{phoneText(phone)}</span>}{' '}
        <button type="button" className={compact ? 'btn small ghost' : 'btn'}
          onClick={() => { save.reset(); setValue(phoneToInput(phone?.replace(/^\+/, ''))); setOpen(true) }}>Изменить</button>
        {!compact && <p className="hint">Без Telegram это его единственный вход <HelpHint title="Телефон">{PHONE_HINT} Номер можно сменить, но не убрать.</HelpHint></p>}
      </div>
    )
  }
  return (
    <form className="form narrow" aria-label={`Телефон: ${name ?? ''}`} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Телефон</span>
        <PhoneInput label="Телефон" value={value} onChange={setValue} />
      </label>
      <p className="hint">{PHONE_HINT} После смены прежний пароль по номеру перестанет действовать.</p>
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.phone ?? save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending || !value.trim()}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  )
}
