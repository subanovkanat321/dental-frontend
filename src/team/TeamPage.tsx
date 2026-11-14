import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { openMine } from '../lib/route'
import { SubHeader } from '../settings/SubHeader'
import { AddStaffPanel } from './AddStaff'
import { DoctorPanel } from './DoctorPanel'
import { InvitePanel, MemberPanel } from './MemberPanel'
import type { Doctor } from './PhoneParts'
import { StaffTab, type Opened } from './StaffTab'
import { TimeOffTab } from './TimeOffTab'
import { HeadSlotProvider } from '../layout/PageHead'
import { useHeadSlot } from '../layout/headSlot'

type Me = Schemas['BookingViewsMe']
/** doctors — «Персонал» (врачи и сотрудники вместе; адрес прежний, закладки работают). */
export type TeamTab = 'doctors' | 'timeoff'

/**
 * «Клиника → Персонал» (и «Перерывы и выходные» в «Рабочем времени»): все, кто работает в клинике, одним
 * списком; одна кнопка «＋ Добавить сотрудника» в шапке списка (руководитель) и одна карточка на человека — врача
 * ({@link DoctorPanel}), сотрудника ({@link MemberPanel}) или приглашённого ({@link InvitePanel}). Карточка —
 * панель справа на компьютере и экран на телефоне. Права проверяет и сервер.
 */
export function TeamPage({ me, only, title, onBack, initialOpened = null, tabs: itemTabs }: {
  me: Me
  only: TeamTab
  title: string
  onBack: () => void
  /** Вкладки пункта «Рабочее время» (врачи, смены, перерывы) */
  tabs?: React.ReactNode
  /** Сразу карточка этого врача. */
  initialOpened?: number | null
}) {
  const [opened, setOpened] = useState<Opened | null>(initialOpened == null ? null : { kind: 'doctor', id: initialOpened })
  const [slot, setSlot] = useHeadSlot()
  const close = useCallback(() => setOpened(null), [setOpened])
  const admin = useQuery({
    queryKey: ['doctors-admin'],
    queryFn: () => unwrap(api.GET('/api/doctors/admin')),
    enabled: Boolean(me.admin),
  })
  const members = useQuery({ queryKey: ['members'], queryFn: () => unwrap(api.GET('/api/members')), enabled: Boolean(me.admin) })
  const invites = useQuery({ queryKey: ['member-invites'], queryFn: () => unwrap(api.GET('/api/members/invites')), enabled: Boolean(me.admin) })
  // Не админу — врачи из me (без Telegram и ролей: их видит только админ)
  const doctors: Doctor[] = me.admin ? admin.data ?? [] : (me.doctors ?? []).filter((d) => d.active !== false)
  const openedDoctor = opened?.kind === 'doctor' ? doctors.find((d) => d.id === opened.id) : undefined
  const openedMember = opened?.kind === 'member' ? members.data?.find((m) => m.telegramId === opened.telegramId) : undefined
  const openedInvite = opened?.kind === 'invite' ? invites.data?.find((i) => i.id === opened.id) : undefined
  // Один человек — одна карточка: скрытый врач, который ещё и сотрудник, — карточка сотрудника; сотрудник,
  // которому дали «Врач», — врачебная
  const doctorMember = openedDoctor?.telegramId != null ? members.data?.find((m) => m.telegramId === openedDoctor.telegramId) : undefined
  const member = openedMember ?? (openedDoctor?.active === false ? doctorMember : undefined)
  const memberDoctor = member ? doctors.find((d) => d.telegramId === member.telegramId) : undefined
  const doctorPanel = openedDoctor && !(openedDoctor.active === false && doctorMember) ? openedDoctor
    : memberDoctor && memberDoctor.active !== false ? memberDoctor : undefined

  return (
    <div className={opened ? 'schedule with-panel' : 'schedule'}>
      <HeadSlotProvider slot={slot}>
      <section className="schedule-main">
        <SubHeader title={title} onBack={onBack} slotRef={setSlot}>
          {itemTabs}
        </SubHeader>
        {only === 'doctors' && (
          <StaffTab me={me} doctors={doctors} members={members.data ?? []} invites={invites.data ?? []}
            loading={Boolean(me.admin) && (admin.isPending || members.isPending)} error={admin.error ?? members.error} opened={opened}
            onOpen={(o) => (o.kind === 'doctor' && o.id === me.doctorId && !me.admin ? openMine('me', 'profile') : setOpened(o))}
            onAdd={me.admin ? () => setOpened({ kind: 'new' }) : undefined} />
        )}
        {only === 'timeoff' && <TimeOffTab me={me} />}
      </section>
      </HeadSlotProvider>
      {opened?.kind === 'new' && <AddStaffPanel me={me} onClose={close} onAdded={setOpened} />}
      {doctorPanel && <DoctorPanel key={doctorPanel.id} doctor={doctorPanel} me={me} onClose={close} />}
      {!doctorPanel && member && (
        <MemberPanel key={member.telegramId} me={me} member={member} hiddenDoctor={memberDoctor} onClose={close} />
      )}
      {openedInvite && <InvitePanel key={openedInvite.id} invite={openedInvite} onClose={close}
        onPhone={(telegramId) => setOpened({ kind: 'member', telegramId })} />}
    </div>
  )
}
