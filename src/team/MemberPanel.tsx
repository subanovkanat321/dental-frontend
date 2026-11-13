import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { ask } from '../lib/confirm'
import { shortDate } from '../lib/time'
import { useClose } from '../lib/useClose'
import { InviteLink } from './InviteLink'
import { StaffPhone, TemporaryPassword, type Doctor } from './PhoneParts'
import { RolesEditor } from './RolesEditor'
import { useRefreshStaff } from './staffRoles'
import { StaffWeekly } from './StaffWeekly'
import { phoneText, ROLE_TEXT } from './texts'

type Me = Schemas['BookingViewsMe']
type Member = Schemas['StaffMembersMemberView']
type Invite = Schemas['StaffMembersInviteView']

/**
 * Карточка сотрудника без кресла (руководитель, регистратура, ассистент) — та же, что у врача, только
 * без «Для пациентов» и кресла: имя, роли (флажки; ассистенту — его врачи), вход (Telegram или номер,
 * временный пароль) и недельный график. Скрытый врач с той же ролью — тоже здесь: вернуть
 * «Врач» можно флажком. Открывает руководитель.
 */
export function MemberPanel({ me, member: m, hiddenDoctor, onClose }: { me: Me; member: Member; hiddenDoctor?: Doctor; onClose: () => void }) {
  const close = useClose(onClose)
  const refresh = useRefreshStaff()
  const name = m.fullName || (m.phone ? phoneText(m.phone) : `Telegram ${m.telegramId}`)
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/members/{telegramId}', { params: { path: { telegramId: m.telegramId } } })),
    onSuccess: () => {
      // Ушли из руководителей сами — доступы другие: начать заново
      if (m.me) window.location.reload()
      else {
        refresh()
        onClose()
      }
    },
  })
  return (
    <aside className="panel" aria-label="Сотрудник">
      <header className="panel-head">
        <div>
          <h2>{name}</h2>
          <span className="hint">{[ROLE_TEXT[m.role ?? ''], m.me ? 'это вы' : null, hiddenDoctor ? 'врач скрыт' : null].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>

      <section className="doctor-group" aria-label="Роли">
        <h3 className="group-title">Роли</h3>
        {hiddenDoctor && <p className="hint">Врач «{hiddenDoctor.fullName}» скрыт: пациенты его не видят, история приёмов на месте. Вернуть — роль «… и врач» в списке.</p>}
        <RolesEditor key={`${m.role}-${hiddenDoctor?.active}`} me={me} telegramId={m.telegramId} doctorId={hiddenDoctor?.id} doctor={false}
          role={m.role as 'ADMIN'} doctorIds={m.doctorIds} self={Boolean(m.me)} hasLogin name={name} />
      </section>

      <section className="doctor-group" aria-label="Вход">
        <h3 className="group-title">Вход</h3>
        <p className="tone-ok">{m.phoneOnly ? '✓ Входит по номеру (без Telegram)' : '✓ Telegram привязан'}</p>
        <StaffPhone telegramId={m.telegramId} phone={m.phone} phoneOnly={m.phoneOnly} name={name} />
        {/* Вход по номеру без SMS: временный пароль даёт руководитель (себе — нет: свой меняют в «Моём профиле») */}
        {m.phoneOnly && !m.me && <TemporaryPassword telegramId={m.telegramId} name={name} />}
      </section>

      <section className="doctor-group" aria-label="Недельный график">
        <h3 className="group-title">Часы работы</h3>
        <p className="hint">Обычная неделя; смены на даты — в «Рабочее время → Смены персонала», поверх графика.</p>
        <StaffWeekly telegramId={m.telegramId} canEdit={Boolean(me.admin)} />
      </section>

      <div className="danger-zone">
        <p className="hint">Доступ пропадёт сразу; выплаты зарплаты останутся в «Касса → Зарплата» за свои месяцы.</p>
        <button type="button" className="btn danger" disabled={remove.isPending}
          onClick={() => void ask(m.me ? 'Выйти из руководителей клиники?' : `Убрать «${name}» из клиники? Доступ пропадёт сразу.`)
            .then((ok) => ok && remove.mutate())}>{m.me ? 'Выйти из руководителей' : 'Убрать из клиники'}</button>
        {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
      </div>
    </aside>
  )
}

/**
 * Карточка приглашённого, который ещё не вошёл: кем пригласили, до какого времени ссылка, «Новая ссылка»
 * (истекла, потерялась или при добавлении выбрали «позже»), «Нет Telegram — по номеру» и «Отменить».
 */
export function InvitePanel({ invite: i, onClose, onPhone }: { invite: Invite; onClose: () => void; onPhone: (telegramId: number) => void }) {
  const close = useClose(onClose)
  const refresh = useRefreshStaff()
  const [token, setToken] = useState<string | null>(null)
  const [byPhone, setByPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const renew = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/invites/{id}/renew', { params: { path: { id: i.id! } } })),
    onSuccess: (r) => {
      setToken(r.token ?? null)
      refresh()
    },
  })
  const toPhone = useMutation<Schemas['StaffMembersControllerPhoneInvited'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/members/invites/{id}/phone', { params: { path: { id: i.id! } }, body: { phone: phoneFromInput(phone) } })),
    onSuccess: (r) => {
      refresh()
      onPhone(r.telegramId)
    },
  })
  const cancel = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/members/invites/{id}', { params: { path: { id: i.id! } } })),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })
  const toWhom = i.role === 'ADMIN' ? 'руководителю' : i.role === 'ASSISTANT' ? 'ассистенту' : 'регистратору'
  return (
    <aside className="panel" aria-label="Приглашение">
      <header className="panel-head">
        <div>
          <h2>{i.fullName}</h2>
          <span className="hint">{ROLE_TEXT[i.role ?? '']} · ждём входа</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <section className="doctor-group" aria-label="Вход">
        <h3 className="group-title">Вход</h3>
        <p className="tone-wait">{i.expired ? 'Ссылка истекла — нужна новая' : `Ссылка действует до ${shortDate(i.expiresAt!, true)}`}</p>
        <p className="hint">Человек появится в «Персонале», когда откроет ссылку и нажмёт «Начать» в Telegram (или войдёт по номеру).
          Роль меняют после входа.</p>
        {token
          ? <InviteLink start={`staff_${token}`} name={i.fullName ?? ''} toWhom={toWhom} />
          : <button type="button" className="btn" disabled={renew.isPending} onClick={() => renew.mutate()}>Новая ссылка</button>}
        {renew.error && <p className="error" role="alert">{renew.error.message}</p>}
        {!byPhone ? (
          <button type="button" className="link" onClick={() => setByPhone(true)}>Нет Telegram? Вход по номеру телефона</button>
        ) : (
          <form className="form" aria-label="Вход по номеру" onSubmit={(e) => { e.preventDefault(); toPhone.mutate() }}>
            <label className="field"><span>Номер телефона</span>
              <PhoneInput label="Номер телефона сотрудника" value={phone} onChange={setPhone} />
            </label>
            {toPhone.error && <p className="error" role="alert">{toPhone.error.fieldErrors.phone ?? toPhone.error.message}</p>}
            <div className="actions">
              <button type="submit" className="btn primary" disabled={toPhone.isPending || !phone.trim()}>Вход по номеру</button>
              <button type="button" className="btn ghost" onClick={() => setByPhone(false)}>Отмена</button>
            </div>
          </form>
        )}
      </section>
      <div className="danger-zone">
        <button type="button" className="btn danger" disabled={cancel.isPending}
          onClick={() => void ask(`Отменить приглашение «${i.fullName}»? Ссылка перестанет работать.`).then((ok) => ok && cancel.mutate())}>
          Отменить приглашение</button>
        {cancel.error && <p className="error" role="alert">{cancel.error.message}</p>}
      </div>
    </aside>
  )
}
