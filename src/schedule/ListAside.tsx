import { useState, type ReactNode } from 'react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { addDays } from '../lib/time'
import { AttentionStats, NextPatient } from './DaySummary'
import { DoctorMonth } from './DoctorCalendar'
import './doctorCalendar.css'

type Appointment = Schemas['AppointmentView']

/**
 * «Список» одного врача на широком экране (от 1280px, владелец 2026-11-27): справа от списка дня — панель «Сегодня»
 * вместо пустого места. Только то, что уже есть на странице: «Следующий пациент» (нажать — карточка приёма), «Требует
 * внимания» (те же плашки, что в строке над списком: заявки, ждём ответа, к оплате — роли решает SchedulePage, как для
 * плашек) и месяц врача — нажать на день, он откроется. Открыли карточку приёма — она встаёт на это место.
 */
export function ListAside({ date, today, all, doctor, requests, waiting, toPay, low, onOpen, onNavigate, onDate, reviewAsks, onReviewAsks, extra }: {
  date: string
  today: string
  /** Приёмы дня врача без отменённых */
  all: Appointment[]
  doctor: { id: number; name: string }
  requests: Appointment[]
  waiting: Appointment[]
  toPay: number
  low: number
  onOpen: (a: Appointment) => void
  onNavigate?: (page: Page) => void
  onDate: (date: string) => void
  reviewAsks?: number
  onReviewAsks?: () => void
  /** Ещё плашки: просроченные задачи, дни рождения, выручка, «мой заработок» — как в строке над списком */
  extra?: ReactNode
}) {
  const calm = !requests.length && !waiting.length && !toPay && !low
  // Приёмы были, но впереди никого — «Открыть завтра»; пустой день — эти действия в самом списке (DayList, emptyActions)
  const next = all.length > 0 && (
    <button type="button" className="btn small" onClick={() => onDate(addDays(date, 1))}>{date === today ? 'Открыть завтра' : 'Следующий день'} ›</button>
  )
  return (
    <aside className="list-aside" aria-label={date === today ? 'Сегодня' : 'Этот день'}>
      <NextPatient date={date} today={today} all={all} onOpen={onOpen} empty={next || undefined} />
      <section className="ds-block">
        <h2 className="ds-title">Требует внимания</h2>
        <AttentionStats requests={requests} waiting={waiting} toPay={toPay} low={low} onOpen={onOpen} onNavigate={onNavigate}
          reviewAsks={reviewAsks} onReviewAsks={onReviewAsks} extra={extra} calm={calm} />
      </section>
      {/* key: перешли стрелками в другой месяц — календарь показывает его, а не тот, что листали */}
      <AsideMonth key={date.slice(0, 7)} doctor={doctor} date={date} today={today} onDate={onDate} />
    </aside>
  )
}

function AsideMonth({ doctor, date, today, onDate }: { doctor: { id: number; name: string }; date: string; today: string; onDate: (date: string) => void }) {
  const [month, setMonth] = useState(date.slice(0, 7))
  return (
    <section className="ds-block list-aside-month doc-cal" aria-label={`Календарь врача: ${doctor.name}`}>
      <DoctorMonth doctorId={doctor.id} month={month} onMonth={setMonth} date={date} today={today} onPick={onDate} legend={false} />
    </section>
  )
}
