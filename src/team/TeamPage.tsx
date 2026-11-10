import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { openSettings } from '../lib/route'
import { SubHeader } from '../settings/SubHeader'
import { DoctorPanel, NewDoctorPanel } from './DoctorPanel'
import { StaffTab } from './StaffTab'
import { TimeOffTab } from './TimeOffTab'
import { HeadSlotProvider } from '../layout/PageHead'
import { useHeadSlot } from '../layout/headSlot'

type Me = Schemas['BookingViewsMe']
type Doctor = Schemas['DoctorAdminView']
/** doctors — «Персонал» (врачи и сотрудники вместе; адрес прежний, закладки работают). */
export type TeamTab = 'doctors' | 'timeoff'
type Tab = TeamTab

/**
 * «Команда»: персонал — врачи (профиль, фото, часы работы, приглашение, права) и сотрудники (админы,
 * регистратура, ассистенты) одним списком с ролями — и перерывы с выходными. Врачей и сотрудников ведёт админ; врач правит себя,
 * регистратура — часы врачей. Проверяет и сервер.
 */
export function TeamPage({ me, only, title, onBack, initialOpened = null, tabs: itemTabs }: {
  me: Me
  /** Вкладки пункта «Настроек» («Рабочее время»: врачи, смены, перерывы) */
  tabs?: React.ReactNode
  only?: Tab
  title?: string
  onBack?: () => void
  /** «Мой профиль»: сразу карточка этого врача. */
  initialOpened?: number | null
}) {
  const tabs: [Tab, string][] = [['doctors', 'Персонал'], ['timeoff', 'Перерывы']]
  const [chosen, setTab] = useState<Tab>('doctors')
  const tab = only ?? chosen
  const [opened, setOpened] = useState<number | 'new' | null>(initialOpened)
  const [slot, setSlot] = useHeadSlot()
  const close = useCallback(() => setOpened(null), [setOpened])
  const admin = useQuery({
    queryKey: ['doctors-admin'],
    queryFn: () => unwrap(api.GET('/api/doctors/admin')),
    enabled: Boolean(me.admin),
  })
  // Не админу — врачи из me (без Telegram и ролей: их видит только админ)
  const doctors: Doctor[] = me.admin ? admin.data ?? [] : (me.doctors ?? []).filter((d) => d.active !== false)
  const openedDoctor = typeof opened === 'number' ? doctors.find((d) => d.id === opened) : undefined
  const addButtons = me.admin && (
    <>
      <button type="button" className="btn" onClick={() => document.getElementById('invite-member')?.scrollIntoView({ behavior: 'smooth' })}>+ Пригласить сотрудника</button>
      <button type="button" className="btn primary" onClick={() => setOpened('new')}>+ Добавить врача</button>
    </>
  )

  return (
    <div className={opened ? 'schedule with-panel' : 'schedule'}>
      <HeadSlotProvider slot={slot}>
      <section className="schedule-main">
        {only && onBack ? (
          <SubHeader title={title ?? ''} onBack={onBack} slotRef={setSlot}>
            {itemTabs}
            {tab === 'doctors' && addButtons}
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
            {tab === 'doctors' && addButtons}
          </header>
        )}

        {tab === 'doctors' && (
          <>
            <StaffTab me={me} doctors={doctors} loading={Boolean(me.admin) && admin.isPending} error={admin.error} opened={opened}
              onOpen={(id) => (typeof id === 'number' && id === me.doctorId && !initialOpened ? openSettings('profile') : setOpened(id))} />
            {me.doctorId == null && (me.admin || me.reception) && <section className="card-block"><AddSelf /></section>}
          </>
        )}
        {tab === 'timeoff' && <TimeOffTab me={me} />}
      </section>
      </HeadSlotProvider>
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
