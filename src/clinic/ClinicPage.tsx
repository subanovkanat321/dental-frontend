import { useState } from 'react'

import type { Schemas } from '../api/client'
import { SubHeader } from '../settings/SubHeader'
import { AboutTab } from './AboutTab'
import { MemosTab } from './MemosTab'
import { NewsTab } from './NewsTab'
import { QuestionsTab } from './QuestionsTab'
import { ServicesTab } from './ServicesTab'

type Me = Schemas['BookingViewsMe']
export type ClinicTab = 'services' | 'memos' | 'about' | 'questions' | 'news'
type Tab = ClinicTab

/**
 * «Клиника»: настройки, которые видят пациенты, — услуги (для самозаписи в боте), «О клинике»,
 * анкета пациента и новости (админ). Вкладка сама рисует рабочую область и карточку справа.
 */
export function ClinicPage({ me, only, title, onBack }: { me: Me; only?: Tab; title?: string; onBack?: () => void }) {
  const tabs: [Tab, string][] = [['services', 'Услуги'], ['memos', 'Памятки'], ['about', 'О клинике'], ['questions', 'Анкета'],
    ...(me.admin ? [['news', 'Новости'] as [Tab, string]] : [])]
  const [chosen, setTab] = useState<Tab>('services')
  const tab = only ?? chosen
  const [panel, setPanel] = useState(false)
  const header = only && onBack ? <SubHeader title={title ?? ''} onBack={onBack} /> : (
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
      {tab === 'memos' && <MemosTab me={me} header={header} onPanel={setPanel} />}
      {tab === 'questions' && <QuestionsTab me={me} header={header} onPanel={setPanel} />}
      {(tab === 'about' || tab === 'news') && (
        <section className="schedule-main">
          {header}
          {tab === 'about' && <AboutTab me={me} />}
          {tab === 'news' && <NewsTab />}
        </section>
      )}
    </div>
  )
}
