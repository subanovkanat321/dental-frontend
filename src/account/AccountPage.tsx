import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { SubHeader } from '../settings/SubHeader'
import { AgreementTab } from './AgreementTab'
import { DataTab } from './DataTab'
import { DentalNewsTab } from './DentalNewsTab'
import { PlanTab } from './PlanTab'
import { PrivacyTab } from './PrivacyTab'
import { SupportTab } from './SupportTab'
import { seesAllMoney } from '../lib/roles'

type Me = Schemas['BookingViewsMe']
export type AccountTab = 'plan' | 'agreement' | 'data' | 'news' | 'support' | 'privacy'
type Tab = AccountTab

/**
 * «Аккаунт»: отношения клиники с платформой. Админу — тариф и оплата, договор, данные (выгрузка
 * и журнал); всем — техподдержка, новости стоматологии и конфиденциальность. Права проверяет и сервер.
 */
export function AccountPage({ me, initialTab, initialTicket, initialHelp, only, title, onBack }: {
  me: Me
  initialTab?: string
  initialTicket?: number
  /** Сразу открыть чат «💬 Помощь» (в «Техподдержке»). */
  initialHelp?: boolean
  only?: Tab
  title?: string
  onBack?: () => void
}) {
  const seesAll = seesAllMoney(me)
  const tabs: [Tab, string][] = [
    ...(me.admin ? [['plan', 'Тариф и оплата'], ['agreement', 'Договор']] as [Tab, string][] : []),
    ...(me.admin || seesAll ? [['data', 'Данные']] as [Tab, string][] : []),
    ['support', 'Техподдержка'], ['news', 'Новости стоматологии'], ['privacy', 'Конфиденциальность'],
  ]
  const [chosen, setTab] = useState<Tab>(tabs.find(([key]) => key === initialTab)?.[0] ?? tabs[0]![0])
  const tab = only ?? chosen
  const [panel, setPanel] = useState(false)
  // Контакты поддержки клиники — из «О клинике» (читать могут все сотрудники)
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: tab === 'support' })
  const header = only && onBack ? <SubHeader title={title ?? ''} onBack={onBack} /> : (
    <header className="toolbar">
      <h1>Аккаунт</h1>
      <div className="segments tabs" role="tablist" aria-label="Разделы аккаунта">
        {tabs.map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key}
            onClick={() => { setTab(key); setPanel(false) }}>{title}</button>
        ))}
      </div>
    </header>
  )
  return (
    <div className={panel ? 'schedule with-panel' : 'schedule'}>
      {tab === 'support' ? <SupportTab me={me} clinic={clinic.data} header={header} onPanel={setPanel} initialTicket={initialTicket} initialHelp={initialHelp} /> : (
        <section className="schedule-main">
          {header}
          {tab === 'plan' && <PlanTab />}
          {tab === 'agreement' && <AgreementTab />}
          {tab === 'data' && <DataTab me={me} seesAll={seesAll} />}
          {tab === 'privacy' && <PrivacyTab me={me} />}
          {tab === 'news' && <DentalNewsTab me={me} />}
        </section>
      )}
    </div>
  )
}
