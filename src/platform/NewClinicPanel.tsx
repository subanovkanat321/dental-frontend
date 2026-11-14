import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { CITIES } from '../lib/clinicSearch'
import { phoneDigits } from '../lib/phone'
import { formatPhone, shortDate, todayIn } from '../lib/time'
import { useClose } from '../lib/useClose'
import { InviteLink } from '../team/InviteLink'

type Created = Schemas['PlatformServiceCreated']
type Access = NonNullable<Schemas['PlatformServiceNewClinic']['adminAccess']> | 'LATER'

const ACCESS: [Access, string, string, boolean][] = [
  ['LINK', 'Ссылка-приглашение', 'Пришлёте ссылку — руководитель откроет её и войдёт через Telegram или по номеру на сайте', false],
  ['PHONE', 'Вход по номеру', 'Сразу руководитель клиники: входит на сайте по номеру — первый раз код из SMS, потом свой пароль', true],
  ['LATER', 'Позже', 'Пригласить руководителя потом — в карточке клиники', false],
]

/**
 * «＋ Создать клинику» — карточка справа: название, город, телефон клиники, руководитель (ссылкой, по
 * номеру или позже) и оплата (пилот — бесплатно, или «оплачено до»). Сервер заводит всё одной
 * транзакцией (POST /api/platform/clinics). Вход по номеру и оплату задаёт только владелец платформы —
 * менеджеру этих вариантов не показываем (сервер всё равно ответит 403).
 */
export function NewClinicPanel({ owner, onClose, onOpen }: { owner: boolean; onClose: () => void; onOpen: (id: number, invite?: { name: string; solo: boolean }) => void }) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [phone, setPhone] = useState('')
  const [access, setAccess] = useState<Access>('LINK')
  const [adminName, setAdminName] = useState('')
  const [adminPhone, setAdminPhone] = useState('')
  const [solo, setSolo] = useState(false)
  const [paid, setPaid] = useState(false)
  const [paidUntil, setPaidUntil] = useState('')
  const create = useMutation<Created, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/clinics', {
      body: {
        name, city: city || undefined, phone: phone.trim() ? phoneFromInput(phone) : undefined,
        adminAccess: access === 'LATER' ? undefined : access,
        adminName: access === 'LATER' ? undefined : adminName,
        adminPhone: access === 'PHONE' ? phoneFromInput(adminPhone) : undefined,
        alsoDoctor: access === 'LATER' ? undefined : solo,
        paidUntil: owner && paid && paidUntil ? paidUntil : undefined,
      },
    })),
    onSuccess: (c) => {
      void client.invalidateQueries({ queryKey: ['platform-clinics'] })
      // Руководителя позже — сразу карточка клиники с приглашением наверху, как раньше
      if (access === 'LATER') onOpen(c.id, { name: '', solo })
    },
  })
  const edit = () => create.reset()
  const choices = ACCESS.filter(([, , , ownerOnly]) => owner || !ownerOnly)
  const errors = create.error?.fieldErrors ?? {}
  const fieldError = (f: string) => errors[f] ? <p className="error">{errors[f]}</p> : null

  if (create.data && access !== 'LATER') {
    const c = create.data
    return (
      <aside className="panel" aria-label="Клиника создана">
        <header className="panel-head">
          <h2>{c.clinic?.name ?? name}</h2>
          <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
        </header>
        {c.invite?.token ? (
          <>
            <p className="tone-ok" role="status">Клиника создана. Осталось отправить ссылку руководителю.</p>
            <InviteLink start={`staff_${c.invite.token}`} name={adminName.trim()} toWhom="руководителю клиники"
              phone={phoneDigits(adminPhone)} sms={owner} />
          </>
        ) : (
          <p className="tone-ok" role="status">Клиника создана. {adminName.trim()} — руководитель: входит на сайте по номеру{' '}
            <b className="num">{c.adminPhone ? formatPhone(c.adminPhone.replace('+', '')) : ''}</b> — «Войти по номеру», первый раз код из SMS.</p>
        )}
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onOpen(c.id)}>Открыть карточку клиники</button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="panel" aria-label="Новая клиника">
      <header className="panel-head">
        <h2>Новая клиника</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <form className="form" aria-label="Создать клинику" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <label className="field"><span>Название</span>
          <input value={name} required maxLength={100} autoFocus placeholder="Стоматология «Улыбка»" onChange={(e) => { edit(); setName(e.target.value) }} /></label>
        {fieldError('name')}
        {/* Город — из справочника: по нему каталог и фильтр «Клиник» */}
        <label className="field"><span>Город</span>
          <Select value={city} onChange={(e) => { edit(); setCity(e.target.value) }}>
            <option value="">Не указан — клиника выберет в «О клинике»</option>
            {CITIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select></label>
        <label className="field"><span>Телефон клиники — для пациентов, по желанию</span>
          <PhoneInput label="Телефон клиники" value={phone} onChange={(v) => { edit(); setPhone(v) }} /></label>
        {fieldError('phone')}

        <h3>Руководитель</h3>
        <div className="field"><span>Как войдёт</span>
          <div className="segments wrap" role="group" aria-label="Как войдёт руководитель">
            {choices.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={access === value} onClick={() => { edit(); setAccess(value) }}>{label}</button>
            ))}
          </div>
          <span className="hint small">{ACCESS.find(([v]) => v === access)![2]}</span>
        </div>
        {access !== 'LATER' && (
          <>
            <label className="field"><span>Имя руководителя</span>
              <input value={adminName} required maxLength={100} placeholder="Например: Айбек Осмонов" onChange={(e) => { edit(); setAdminName(e.target.value) }} /></label>
            {fieldError('adminName')}
            <label className="field"><span>{access === 'PHONE' ? 'Номер для входа' : `Телефон — по желанию, отправить ссылку в WhatsApp${owner ? ' или SMS' : ''}`}</span>
              <PhoneInput label="Телефон руководителя" value={adminPhone} onChange={(v) => { edit(); setAdminPhone(v) }} /></label>
            {fieldError('adminPhone')}
          </>
        )}
        <label className="check"><input type="checkbox" checked={solo} onChange={(e) => { edit(); setSolo(e.target.checked) }} /> Частный врач — сам ведёт приём (станет и врачом)</label>

        {owner && (
          <>
            <h3>Оплата</h3>
            <div className="segments" role="group" aria-label="Оплата">
              <button type="button" aria-pressed={!paid} onClick={() => { edit(); setPaid(false) }}>Пилот — бесплатно</button>
              <button type="button" aria-pressed={paid} onClick={() => { edit(); setPaid(true) }}>Оплачено до…</button>
            </div>
            {paid && <label className="field"><span>Оплачено до</span><DateInput min={todayIn()} value={paidUntil} required onChange={(e) => { edit(); setPaidUntil(e.target.value) }} /></label>}
            <span className="hint small">{paid && paidUntil ? `Оплачено до ${shortDate(`${paidUntil}T12:00:00Z`)}; ` : ''}тариф — по числу врачей, сам; оплаты потом — в карточке клиники.</span>
            {fieldError('paidUntil')}
          </>
        )}
        {create.error && !['name', 'phone', 'adminName', 'adminPhone', 'paidUntil'].some((f) => errors[f]) && (
          <p className="error" role="alert">{create.error.message}</p>
        )}
        <button type="submit" className="btn primary" disabled={create.isPending || (access === 'PHONE' && !adminPhone.trim()) || (paid && !paidUntil)}>Создать клинику</button>
      </form>
    </aside>
  )
}
