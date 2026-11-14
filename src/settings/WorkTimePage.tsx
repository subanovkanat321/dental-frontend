import { useState } from 'react'

import type { Schemas } from '../api/client'
import { Segments } from '../layout/Segments'
import { useMedia } from '../lib/useMedia'
import { TeamPage } from '../team/TeamPage'
import { WorkSchedule } from '../team/WorkSchedule'

type Me = Schemas['BookingViewsMe']
/** Пункт из адреса: #/clinic/hours — «Обычная неделя», #/clinic/shifts (кнопка бота «Кто на смене») — «Неделя по датам», #/clinic/timeoff — перерывы. */
export type WorkTimeItem = 'hours' | 'shifts' | 'timeoff'

/** Вид «Рабочего времени»: обычная неделя каждого, неделя по датам с исключениями, перерывы и выходные. */
type View = 'template' | 'week' | 'timeoff'

const TITLE = 'Рабочее время'
const VIEWS: [View, string, string][] = [
  ['template', 'Обычная неделя', 'Обычная'],
  ['week', 'Неделя по датам', 'По датам'],
  ['timeoff', 'Перерывы и выходные', 'Перерывы'],
]
const FIRST: Record<WorkTimeItem, View> = { hours: 'template', shifts: 'week', timeoff: 'timeoff' }

/**
 * «Клиника → Рабочее время»: кто и когда работает. Один ряд переключателя (с 2026-11-14 вместо двух —
 * «График | Перерывы» и под ним «Обычная неделя | Неделя по датам»): обычная неделя каждого с часами
 * клиники, неделя по датам с исключениями и перерывы с выходными (обед, намаз, отпуск, праздники — их
 * список в сетку людей не помещается).
 *
 * Переходы между видами — состоянием этой страницы, а не адресом: адрес пункта и так #/clinic/hours,
 * переход на тот же адрес ничего не делает (так и сломалась кнопка «Часы работы врачей», 2026-11-13).
 * На телефоне подписи короче: три полных в 390px не помещаются в строку.
 */
export function WorkTimePage({ me, onBack, initial }: { me: Me; onBack: () => void; initial: WorkTimeItem }) {
  const [view, setView] = useState<View>(FIRST[initial])
  const phone = useMedia('(max-width: 640px)')
  const nav = (
    <Segments className="work-nav" label={TITLE} value={view} onChange={setView}
      options={VIEWS.map(([value, long, short]) => ({ value, label: phone ? short : long, text: long, title: phone ? long : undefined }))} />
  )
  if (view === 'timeoff') return <TeamPage me={me} only="timeoff" title={TITLE} onBack={onBack} tabs={nav} />
  return <WorkSchedule me={me} mode={view} onMode={setView} onTimeOff={() => setView('timeoff')} title={TITLE} onBack={onBack} tabs={nav} />
}
