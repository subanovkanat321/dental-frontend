import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SubHeader } from '../settings/SubHeader'
import { DoctorPanel, NewDoctorPanel } from './DoctorPanel'
import { MembersTab } from './MembersTab'
import { ROLE_TEXT } from './texts'
import { TimeOffTab } from './TimeOffTab'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']
export type TeamTab = 'doctors' | 'members' | 'timeoff'
type Tab = TeamTab

/**
 * «Команда»: врачи (профиль, фото, часы работы, приглашение, права), сотрудники (админы и
 * регистратура) и перерывы с выходными. Врачей и сотрудников ведёт админ; врач правит себя,
 * регистратура — часы врачей. Проверяет и сервер.
 */
export function TeamPage({ me, only, title, onBack, initialOpened = null }: {
  me: Me
  only?: Tab
  title?: string
  onBack?: () => void
  /** «Мой профиль»: сразу карточка этого врача. */
  initialOpened?: number | null
}) {
  const tabs: [Tab, string][] = [['doctors', 'Врачи'], ...(me.admin ? [['members', 'Сотрудники'] as [Tab, string]] : []), ['timeoff', 'Перерывы']]
  const [chosen, setTab] = useState<Tab>('doctors')
  const tab = only ?? chosen
  const [opened, setOpened] = useState<number | 'new' | null>(initialOpened)
  const close = useCallback(() => setOpened(null), [setOpened])
  const admin = useQuery({
    queryKey: ['doctors-admin'],
    queryFn: () => unwrap(api.GET('/api/doctors/admin')),
    enabled: Boolean(me.admin),
  })
  // Не админу — врачи из me (без Telegram и ролей: их видит только админ)
  const doctors: Doctor[] = me.admin ? admin.data ?? [] : (me.doctors ?? []).filter((d) => d.active !== false)
  const openedDoctor = typeof opened === 'number' ? doctors.find((d) => d.id === opened) : undefined
  const canOpen = (d: Doctor) => Boolean(me.admin || me.reception || d.id === me.doctorId)

  return (
    <div className={opened ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        {only && onBack ? (
          <SubHeader title={title ?? ''} onBack={onBack}>
            {tab === 'doctors' && me.admin && <button type="button" className="btn primary" onClick={() => setOpened('new')}>+ Добавить врача</button>}
          </SubHeader>
        ) : (
          <header className="toolbar">
            <h1>Команда</h1>
            <div className="segments tabs" role="tablist" aria-label="Разделы команды">
              {tabs.map(([key, name]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key}
                  onClick={() => { setTab(key); setOpened(null) }}>{name}</button>
              ))}
            </div>
            {tab === 'doctors' && me.admin && <button type="button" className="btn primary" onClick={() => setOpened('new')}>+ Добавить врача</button>}
          </header>
        )}

        {tab === 'doctors' && (
          <section className="card-block">
            <p className="hint">У каждого врача своё расписание. Врач с привязанным Telegram входит в CRM и получает уведомления о своих приёмах.</p>
            {admin.error && <p className="error">{admin.error.message}</p>}
            {me.admin && admin.isPending ? <p className="hint">Загрузка…</p> : doctors.length ? (
              <table className="table" aria-label="Врачи">
                <thead><tr><th>Врач</th><th>Кратко</th>{me.admin && <th>Telegram</th>}<th /></tr></thead>
                <tbody>
                  {doctors.map((d) => (
                    <tr key={d.id} className={[d.id === opened ? 'active' : '', d.active === false ? 'inactive' : ''].join(' ').trim() || undefined}>
                      <td>
                        <span className="who">
                          {d.photoUrl ? <img className="avatar" src={d.photoUrl} alt="" /> : <span className="avatar" aria-hidden="true">{(d.fullName ?? '?').slice(0, 1)}</span>}
                          {canOpen(d)
                            ? <button type="button" className="row-link" onClick={() => setOpened(d.id!)}>{d.fullName}</button>
                            : <span>{d.fullName}</span>}
                        </span>
                      </td>
                      <td className="hint">{d.about || '—'}</td>
                      {me.admin && <td className={d.telegramId ? undefined : 'tone-wait'}>{d.telegramId ? 'привязан' : 'не привязан'}</td>}
                      <td className="hint">{[d.id === me.doctorId ? 'это вы' : null, d.role ? `ещё и ${ROLE_TEXT[d.role]?.toLowerCase()}` : null,
                        d.active === false ? 'скрыт' : null].filter(Boolean).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="hint">Врачей пока нет.</p>}
            {me.doctorId == null && (me.admin || me.reception) && <AddSelf />}
          </section>
        )}
        {tab === 'members' && me.admin && <MembersTab />}
        {tab === 'timeoff' && <TimeOffTab me={me} />}
      </section>
      {opened === 'new' && <NewDoctorPanel onClose={close} onCreated={(d) => setOpened(d.id!)} />}
      {openedDoctor && <DoctorPanel key={openedDoctor.id} doctor={openedDoctor} me={me} onClose={close} />}
    </div>
  )
}

/**
 * «Я тоже веду приём»: админ (частный врач в своём кабинете) или регистратор становится и врачом —
 * со своим расписанием, часами и пациентами. Права администратора остаются.
 */
function AddSelf() {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const add = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/doctors/me', { body: { fullName: name } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['me'] })
      void client.invalidateQueries({ queryKey: ['doctors-admin'] })
    },
  })
  return (
    <form className="form sub-form" aria-label="Я тоже веду приём" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
      <p className="hint">Вы и принимаете пациентов? Добавьте себя врачом — появится ваше расписание, часы работы и профиль.</p>
      <label className="field"><span>Ваше имя для пациентов</span>
        <input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      {add.error && <p className="error" role="alert">{add.error.fieldErrors.fullName ?? add.error.message}</p>}
      <button type="submit" className="btn" disabled={add.isPending}>Я тоже веду приём</button>
    </form>
  )
}
