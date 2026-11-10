import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ClinicsTab } from './ClinicsTab'
import { ContentTab } from './ContentTab'
import { AiUsageTab } from './AiUsageTab'
import { AgreementsTab, BroadcastTab, TicketsTab } from './OwnerTabs'
import { AnalyticsTab } from './AnalyticsTab'
import { FinanceTab } from './FinanceTab'
import { HealthTab } from './HealthTab'
import { MaterialsTab } from './MaterialsTab'
import { OutreachTab } from './OutreachTab'
import { useBack } from '../lib/back'
import { openSettings } from '../lib/route'
import { SettingsTab } from './SettingsTab'
import { SurveysTab } from './surveys/SurveysTab'
import { TariffsTab } from './TariffsTab'
import { HeadSlotProvider, PageHead } from '../layout/PageHead'
import { useHeadSlot } from '../layout/headSlot'
import { SectionTitle } from '../layout/section'
import { useSection } from '../layout/useSection'

type Me = Schemas['BookingViewsMe']
type Tab = 'clinics' | 'surveys' | 'tickets' | 'broadcast' | 'agreements' | 'tariffs' | 'content' | 'ai' | 'settings'
  | 'analytics' | 'finance' | 'materials' | 'health' | 'outreach'

/**
 * «Платформа» — команда Tish: клиники и опросы сотрудников (менеджеры и владелец); «Написать клиникам» (список стоматологий и WhatsApp по одной), обращения, рассылка, договор,
 * контент-план Instagram, материалы (ролики, презентация), расход ИИ (токены и деньги), финансы (доходы и расходы платформы), здоровье сервера и настройки — только владелец. Права проверяет сервер (/api/platform/*).
 */
export function PlatformPage({ me }: { me: Me }) {
  // Подраздел (бывшие вкладки) — в меню слева, адрес #/platform/<подраздел>; права — layout/nav.ts
  const { sub, subTitle } = useSection('platform', me)
  const tab = (sub ?? 'clinics') as Tab
  const [slot, setSlot] = useHeadSlot()
  const [panel, setPanel] = useState(false)
  // Сменили подраздел — карточка справа прежнего закрыта (её закроет и сам подраздел, но отступ под неё — здесь)
  const [panelTab, setPanelTab] = useState(tab)
  if (panelTab !== tab) {
    setPanelTab(tab)
    setPanel(false)
  }
  // Сотрудник клиники на телефоне попадает сюда из «Настроек» — стрелка Telegram ведёт обратно
  const fromSettings = Boolean(me.doctor) && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches
  useBack(fromSettings ? () => openSettings(null) : null, { url: true })
  const header = (
    <PageHead slotRef={setSlot} title={<>
      {fromSettings && <button type="button" className="btn ghost back" onClick={() => openSettings(null)}>‹ Настройки</button>}
      <SectionTitle page="platform" title="Платформа" subTitle={subTitle} />
    </>} />
  )
  return (
    <HeadSlotProvider slot={slot}>
    <div className={panel ? 'schedule with-panel' : 'schedule'}>
      {tab === 'clinics' && <ClinicsTab me={me} header={header} onPanel={setPanel} />}
      {tab === 'tickets' && <TicketsTab header={header} onPanel={setPanel} />}
      {tab === 'agreements' && <AgreementsTab header={header} onPanel={setPanel} />}
      {tab === 'analytics' && <section className="schedule-main">{header}<AnalyticsTab /></section>}
      {(tab === 'surveys' || tab === 'broadcast' || tab === 'settings' || tab === 'tariffs' || tab === 'content' || tab === 'ai'
        || tab === 'finance' || tab === 'materials' || tab === 'health' || tab === 'outreach') && (
        <section className="schedule-main">
          {header}
          {tab === 'surveys' && <SurveysTab />}
          {tab === 'broadcast' && <BroadcastTab />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'tariffs' && <TariffsTab />}
          {tab === 'content' && <ContentTab />}
          {tab === 'ai' && <AiUsageTab />}
          {tab === 'finance' && <FinanceTab />}
          {tab === 'materials' && <MaterialsTab />}
          {tab === 'health' && <HealthTab />}
          {tab === 'outreach' && <OutreachTab />}
        </section>
      )}
    </div>
    </HeadSlotProvider>
  )
}
