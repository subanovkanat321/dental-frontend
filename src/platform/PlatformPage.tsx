import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ClinicsTab } from './ClinicsTab'
import { AgreementsTab, BroadcastTab, TicketsTab } from './OwnerTabs'
import { useBack } from '../lib/back'
import { openSettings } from '../lib/route'
import { SettingsTab } from './SettingsTab'
import { TariffsTab } from './TariffsTab'

type Me = Schemas['BookingViewsMe']
type Tab = 'clinics' | 'tickets' | 'broadcast' | 'agreements' | 'tariffs' | 'settings'

/**
 * «Платформа» — команда Tish: клиники (менеджеры и владелец); обращения, рассылка, договор и
 * настройки — только владелец. Права проверяет сервер (/api/platform/*).
 */
export function PlatformPage({ me, initialTab }: { me: Me; initialTab?: string }) {
  const tabs: [Tab, string][] = [['clinics', 'Клиники'],
    ...(me.owner ? [['tickets', 'Обращения'], ['broadcast', 'Сообщение клиникам'], ['agreements', 'Договор'], ['tariffs', 'Тарифы'], ['settings', 'Настройки']] as [Tab, string][] : [])]
  const [tab, setTab] = useState<Tab>(tabs.find(([key]) => key === initialTab)?.[0] ?? 'clinics')
  const [panel, setPanel] = useState(false)
  // Сотрудник клиники на телефоне попадает сюда из «Настроек» — стрелка Telegram ведёт обратно
  const fromSettings = Boolean(me.doctor) && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches
  useBack(fromSettings ? () => openSettings(null) : null)
  const header = (
    <header className="toolbar">
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
      {(tab === 'broadcast' || tab === 'settings' || tab === 'tariffs') && (
        <section className="schedule-main">
          {header}
          {tab === 'broadcast' && <BroadcastTab />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'tariffs' && <TariffsTab />}
        </section>
      )}
    </div>
  )
}
