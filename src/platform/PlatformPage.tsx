import { useState, type ReactNode } from 'react'

import type { Schemas } from '../api/client'
import { ClinicsTab } from './ClinicsTab'
import { ContentTab } from './ContentTab'
import { AiUsageTab } from './AiUsageTab'
import { BroadcastTab, TicketsTab } from './OwnerTabs'
import { AnalyticsTab } from './AnalyticsTab'
import { FinanceTab } from './FinanceTab'
import { HealthTab } from './HealthTab'
import { MaterialsTab } from './MaterialsTab'
import { OutreachTab } from './OutreachTab'
import { SettingsTab } from './SettingsTab'
import { SurveysTab } from './surveys/SurveysTab'
import { ModeSwitch } from './ModeSwitch'
import { usePlatformMode } from './modes'
import { HeadSlotProvider, PageHead } from '../layout/PageHead'
import { useHeadSlot } from '../layout/headSlot'
import { SectionTitle } from '../layout/section'
import { useSection } from '../layout/useSection'

type Me = Schemas['BookingViewsMe']
type Tab = 'clinics' | 'analytics' | 'finance' | 'feedback' | 'mailing' | 'marketing' | 'health' | 'ai' | 'settings'

const FEEDBACK = [{ value: 'tickets', label: 'Обращения' }, { value: 'surveys', label: 'Опросы' }] as const
const MAILING = [{ value: 'one', label: 'По одной (WhatsApp)' }, { value: 'all', label: 'Всем сразу (руководителям)' }] as const
const MARKETING = [{ value: 'content', label: 'Контент-план' }, { value: 'materials', label: 'Материалы' }] as const

/**
 * «Платформа» — команда Tish (2026-11-14 — 9 вкладок вместо 14): «Клиники» и опросы — менеджеры и владелец; остальное —
 * только владелец: аналитика, финансы, «Обратная связь» (обращения клиник | опросы сотрудников), «Рассылка клиникам»
 * (по одной в WhatsApp | всем сразу руководителям в бот), «Маркетинг» (контент-план Instagram | материалы), здоровье сервера,
 * расход ИИ и «Настройки» (тарифы, договор с клиниками, оплата, менеджеры, кейс /join…). Права проверяет сервер (/api/platform/*).
 */
export function PlatformPage({ me }: { me: Me }) {
  // Подраздел — вкладкой над страницей, адрес #/platform/<подраздел>[/<режим>]; права — layout/nav.ts
  const { sub, subTitle } = useSection('platform', me)
  const tab = (sub ?? 'clinics') as Tab
  const [slot, setSlot] = useHeadSlot()
  const [panel, setPanel] = useState(false)
  const feedbackModes = me.owner ? FEEDBACK : FEEDBACK.filter((m) => m.value === 'surveys')
  const [feedback, setFeedback] = usePlatformMode('feedback', feedbackModes)
  const [mailing, setMailing] = usePlatformMode('mailing', MAILING)
  const [marketing, setMarketing] = usePlatformMode('marketing', MARKETING)
  const mode = tab === 'feedback' ? feedback : tab === 'mailing' ? mailing : tab === 'marketing' ? marketing : ''
  // Сменили подраздел или режим — карточка справа прежнего закрыта (её закроет и сам подраздел, но отступ под неё — здесь)
  const view = `${tab}/${mode}`
  const [panelView, setPanelView] = useState(view)
  if (panelView !== view) {
    setPanelView(view)
    setPanel(false)
  }
  const modes = tab === 'feedback' ? <ModeSwitch label="Обратная связь" options={feedbackModes} value={feedback} onChange={setFeedback} />
    : tab === 'mailing' ? <ModeSwitch label="Как отправить" options={MAILING} value={mailing} onChange={setMailing} />
      : tab === 'marketing' ? <ModeSwitch label="Маркетинг" options={MARKETING} value={marketing} onChange={setMarketing} />
        : null
  const header = (
    <>
      <PageHead slotRef={setSlot} title={<>
        <SectionTitle page="platform" title="Платформа" subTitle={subTitle} />
      </>} />
      {modes}
    </>
  )
  const inMain = (body: ReactNode) => <section className="schedule-main">{header}{body}</section>
  return (
    <HeadSlotProvider slot={slot}>
    <div className={panel ? 'schedule with-panel' : 'schedule'}>
      {tab === 'clinics' && <ClinicsTab me={me} header={header} onPanel={setPanel} />}
      {tab === 'feedback' && (feedback === 'tickets' ? <TicketsTab header={header} onPanel={setPanel} /> : inMain(<SurveysTab />))}
      {tab === 'settings' && <SettingsTab header={header} onPanel={setPanel} />}
      {tab === 'analytics' && inMain(<AnalyticsTab />)}
      {tab === 'finance' && inMain(<FinanceTab />)}
      {tab === 'mailing' && inMain(mailing === 'all' ? <BroadcastTab /> : <OutreachTab />)}
      {tab === 'marketing' && inMain(marketing === 'materials' ? <MaterialsTab /> : <ContentTab />)}
      {tab === 'health' && inMain(<HealthTab />)}
      {tab === 'ai' && inMain(<AiUsageTab />)}
    </div>
    </HeadSlotProvider>
  )
}
