import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { AgreementTab } from './AgreementTab'
import { DataTab } from './DataTab'
import { PlanTab } from './PlanTab'
import { PrivacyTab } from './PrivacyTab'
import { SupportTab } from './SupportTab'

type Me = Schemas['BookingViewsMe']
type Tab = 'plan' | 'agreement' | 'data' | 'support' | 'privacy'

/**
 * «Аккаунт»: отношения клиники с платформой. Админу — тариф и оплата, договор, данные (выгрузка
 * и журнал); всем — техподдержка и конфиденциальность. Права проверяет и сервер.
 */
export function AccountPage({ me }: { me: Me }) {
  const seesAll = Boolean(me.admin && !me.clinic?.independentDoctors)
  const tabs: [Tab, string][] = [
    ...(me.admin ? [['plan', 'Тариф и оплата'], ['agreement', 'Договор']] as [Tab, string][] : []),
    ...(me.admin || seesAll ? [['data', 'Данные']] as [Tab, string][] : []),
    ['support', 'Техподдержка'], ['privacy', 'Конфиденциальность'],
  ]
  const [tab, setTab] = useState<Tab>(tabs[0]![0])
  const [panel, setPanel] = useState(false)
  // Контакты поддержки клиники — из «О клинике» (читать могут все сотрудники)
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: tab === 'support' })
  const header = (
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
      {tab === 'support' ? <SupportTab me={me} clinic={clinic.data} header={header} onPanel={setPanel} /> : (
        <section className="schedule-main">
          {header}
          {tab === 'plan' && <PlanTab />}
          {tab === 'agreement' && <AgreementTab />}
          {tab === 'data' && <DataTab me={me} seesAll={seesAll} />}
          {tab === 'privacy' && <PrivacyTab me={me} />}
        </section>
      )}
    </div>
  )
}
