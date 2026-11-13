import { useState } from 'react'

import type { Schemas } from '../api/client'
import { TeamPage } from '../team/TeamPage'
import { WorkSchedule, type ScheduleMode } from '../team/WorkSchedule'
import { ItemTabs } from './ItemTabs'

type Me = Schemas['BookingViewsMe']
/** Пункт из адреса: #/clinic/hours — «График», #/clinic/shifts (кнопка бота «Кто на смене») — он же на неделе по датам, #/clinic/timeoff — перерывы. */
export type WorkTimeItem = 'hours' | 'shifts' | 'timeoff'

const TITLE = 'Рабочее время'

/**
 * «Клиника → Рабочее время»: кто и когда работает. «График» — один для всех людей клиники (с 2026-11-13
 * вместо «Врачей» и «Смен персонала»): часы клиники, обычная неделя каждого и неделя по датам с
 * исключениями. «Перерывы и выходные» — обед, намаз, отпуск, праздники (свои и всей клиники) — отдельной
 * вкладкой: их список и общие перерывы клиники в сетку людей не помещаются.
 *
 * Переходы между вкладками — состоянием этой страницы, а не адресом: адрес пункта и так #/clinic/hours,
 * переход на тот же адрес ничего не делает (так и сломалась кнопка «Часы работы врачей», 2026-11-13).
 */
export function WorkTimePage({ me, onBack, initial }: { me: Me; onBack: () => void; initial: WorkTimeItem }) {
  const [tab, setTab] = useState<'schedule' | 'timeoff'>(initial === 'timeoff' ? 'timeoff' : 'schedule')
  const [mode, setMode] = useState<ScheduleMode>(initial === 'shifts' ? 'week' : 'template')
  const tabs = (
    <ItemTabs label={TITLE} value={tab} onChange={setTab} tabs={[['schedule', 'График'], ['timeoff', 'Перерывы и выходные']]} />
  )
  if (tab === 'timeoff') return <TeamPage me={me} only="timeoff" title={TITLE} onBack={onBack} tabs={tabs} />
  return <WorkSchedule me={me} mode={mode} onMode={setMode} onTimeOff={() => setTab('timeoff')} title={TITLE} onBack={onBack} tabs={tabs} />
}
