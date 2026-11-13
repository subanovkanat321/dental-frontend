import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ShiftsPage } from '../team/ShiftsPage'
import { TeamPage } from '../team/TeamPage'
import { HoursPage } from './HoursPage'
import { ItemTabs } from './ItemTabs'

type Me = Schemas['BookingViewsMe']
export type WorkTimeTab = 'doctors' | 'shifts' | 'timeoff'

const TITLE = 'Рабочее время'

/**
 * «Клиника → Рабочее время»: кто и когда работает — одним пунктом. «Врачи» — часы клиники (меняет
 * руководитель) и каждого врача (по ним свободное время в записи), «Смены персонала» — недельный график
 * регистратуры, ассистентов и руководителей без кресла и смены на даты поверх него, «Перерывы и
 * выходные» — обед, намаз, отпуск, праздники. Старые адреса («График смен»,
 * «Перерывы и выходные») открывают свою вкладку.
 */
export function WorkTimePage({ me, onBack, initial }: { me: Me; onBack: () => void; initial: WorkTimeTab }) {
  const [tab, setTab] = useState<WorkTimeTab>(initial)
  const tabs = (
    <ItemTabs label={TITLE} value={tab} onChange={setTab}
      tabs={[['doctors', 'Врачи'], ['shifts', 'Смены персонала'], ['timeoff', 'Перерывы и выходные']]} />
  )
  if (tab === 'timeoff') return <TeamPage me={me} only="timeoff" title={TITLE} onBack={onBack} tabs={tabs} />
  return tab === 'doctors'
    ? <HoursPage me={me} onBack={onBack} title={TITLE} tabs={tabs} onTimeOff={() => setTab('timeoff')} />
    : <ShiftsPage onBack={onBack} title={TITLE} tabs={tabs} />
}
