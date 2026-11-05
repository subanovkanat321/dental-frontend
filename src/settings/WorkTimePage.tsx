import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ShiftsPage } from '../team/ShiftsPage'
import { HoursPage } from './HoursPage'

type Me = Schemas['BookingViewsMe']
type Tab = 'doctors' | 'shifts'

/**
 * «Настройки → Часы и смены»: кто и когда работает — одним пунктом. «Врачи» — часы клиники и каждого
 * врача (по ним свободное время в записи), «Смены персонала» — регистратура, ассистенты и админы без
 * кресла. Старый адрес «График смен» открывает вторую вкладку.
 */
export function WorkTimePage({ me, onBack, initial }: { me: Me; onBack: () => void; initial: Tab }) {
  const [tab, setTab] = useState<Tab>(initial)
  const tabs = (
    <div className="segments tabs" role="tablist" aria-label="Часы и смены">
      {([['doctors', 'Врачи'], ['shifts', 'Смены персонала']] satisfies [Tab, string][]).map(([key, title]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>
      ))}
    </div>
  )
  return tab === 'doctors'
    ? <HoursPage me={me} onBack={onBack} title="Часы и смены" tabs={tabs} />
    : <ShiftsPage onBack={onBack} title="Часы и смены" tabs={tabs} />
}
