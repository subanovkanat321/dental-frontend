import { useState } from 'react'

import type { Schemas } from '../api/client'
import { AboutTab } from './AboutTab'
import { ServicesTab } from './ServicesTab'

type Me = Schemas['BookingViewsMe']
type Tab = 'services' | 'about'

/**
 * «Клиника»: настройки, которые видят пациенты, — услуги (для самозаписи в боте); дальше сюда же
 * «О клинике», анкета пациента и новости. Вкладка сама рисует рабочую область и карточку справа.
 */
export function ClinicPage({ me }: { me: Me }) {
  const tabs: [Tab, string][] = [['services', 'Услуги'], ['about', 'О клинике']]
  const [tab, setTab] = useState<Tab>('services')
  const [panel, setPanel] = useState(false)
  const header = (
    <header className="toolbar">
      <h1>Клиника</h1>
      <div className="segments tabs" role="tablist" aria-label="Разделы клиники">
        {tabs.map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => { setTab(key); setPanel(false) }}>{title}</button>
        ))}
      </div>
    </header>
  )
  return (
    <div className={panel ? 'schedule with-panel' : 'schedule'}>
      {tab === 'services' && <ServicesTab me={me} header={header} onPanel={setPanel} />}
      {tab !== 'services' && (
        <section className="schedule-main">
          {header}
          {tab === 'about' && <AboutTab me={me} />}
        </section>
      )}
    </div>
  )
}
