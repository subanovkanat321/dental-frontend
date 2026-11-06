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
import { useBack } from '../lib/back'
import { openSettings } from '../lib/route'
import { SettingsTab } from './SettingsTab'
import { SurveysTab } from './surveys/SurveysTab'
import { TariffsTab } from './TariffsTab'
import { stickyHead } from '../layout/stickyHead'

type Me = Schemas['BookingViewsMe']
type Tab = 'clinics' | 'surveys' | 'tickets' | 'broadcast' | 'agreements' | 'tariffs' | 'content' | 'ai' | 'settings'
  | 'analytics' | 'finance' | 'materials' | 'health'

/**
 * «Платформа» — команда Tish: клиники и опросы сотрудников (менеджеры и владелец); обращения, рассылка, договор,
 * контент-план Instagram, материалы (ролики, презентация), расход ИИ (токены и деньги), финансы (доходы и расходы платформы), здоровье сервера и настройки — только владелец. Права проверяет сервер (/api/platform/*).
 */
export function PlatformPage({ me, initialTab }: { me: Me; initialTab?: string }) {
  const tabs: [Tab, string][] = [['clinics', 'Клиники'],
    // «Аналитика» и «Финансы» — деньги платформы: только владелец (сервер тоже: менеджеру 403)
    ...(me.owner ? [['analytics', 'Аналитика'], ['finance', 'Финансы']] as [Tab, string][] : []),
    ['surveys', 'Опросы'],
    ...(me.owner ? [['tickets', 'Обращения'], ['broadcast', 'Сообщение клиникам'], ['agreements', 'Договор'], ['tariffs', 'Тарифы'], ['content', 'Контент'], ['materials', 'Материалы'], ['ai', 'Расход ИИ'], ['health', 'Здоровье'], ['settings', 'Настройки']] as [Tab, string][] : [])]
  const [tab, setTab] = useState<Tab>(tabs.find(([key]) => key === initialTab)?.[0] ?? 'clinics')
  const [panel, setPanel] = useState(false)
  // Сотрудник клиники на телефоне попадает сюда из «Настроек» — стрелка Telegram ведёт обратно
  const fromSettings = Boolean(me.doctor) && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches
  useBack(fromSettings ? () => openSettings(null) : null, { url: true })
  const header = (
    <header ref={stickyHead} className="toolbar sticky-head">
      {fromSettings && <button type="button" className="btn ghost back" onClick={() => openSettings(null)}>‹ Настройки</button>}
      <h1>Платформа</h1>
      <div className="segments tabs" role="tablist" aria-label="Разделы платформы">
        {tabs.map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key}
            onClick={() => { setTab(key); setPanel(false) }}>{title}</button>
        ))}
      </div>
    </header>
  )
  return (
    <div className={panel ? 'schedule with-panel' : 'schedule'}>
      {tab === 'clinics' && <ClinicsTab me={me} header={header} onPanel={setPanel} />}
      {tab === 'tickets' && <TicketsTab header={header} onPanel={setPanel} />}
      {tab === 'agreements' && <AgreementsTab header={header} onPanel={setPanel} />}
      {tab === 'analytics' && <section className="schedule-main">{header}<AnalyticsTab /></section>}
      {(tab === 'surveys' || tab === 'broadcast' || tab === 'settings' || tab === 'tariffs' || tab === 'content' || tab === 'ai'
        || tab === 'finance' || tab === 'materials' || tab === 'health') && (
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
        </section>
      )}
    </div>
  )
}
