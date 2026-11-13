import { useQuery } from '@tanstack/react-query'

import { openWeekOf } from '../lib/route'
import { useTimeOff, weeklyDaysOff } from './dayOffHours'
import { WEEK } from './texts'
import { dayHours, loadWeek, personKey, weekKey, weekSummary, type Who } from './workWeek'

/**
 * «Часы работы: Пн–Чт, Сб 9–22 · Пт выходной ›» в карточке врача и сотрудника («Персонал», «Мой профиль»).
 * Один источник правды — «Клиника → Рабочее время → График» (просьба владельца 2026-11-13: «зачем здесь часы,
 * они же есть в „Рабочем времени“»): строка только показывает неделю, нажатие открывает график с раскрытым
 * редактором этого человека (#/clinic/hours/d12). Права там же: кто не может менять — увидит неделю текстом.
 * Выходной — еженедельный на весь день из «Перерывов и выходных» (у врача: его и всей клиники).
 */
export function HoursLink({ who }: { who: Who }) {
  const week = useQuery({ queryKey: weekKey(who), queryFn: () => loadWeek(who) })
  const timeOff = useTimeOff()
  const off = who.kind === 'doctor' ? weeklyDaysOff(timeOff.data, who.id) : {}
  const offDays = WEEK.filter(([code]) => off[code]).map(([, , short]) => short)
  const hours = week.data && (week.data.custom ? weekSummary(dayHours(week.data.days, off)) : 'как у клиники')
  const summary = week.error ? 'не загрузились' : hours ? [hours, offDays.length ? `${offDays.join(', ')} выходной` : null].filter(Boolean).join(' · ') : '…'
  return (
    <button type="button" className="fold-head hours-link" aria-label={`Часы работы: ${summary} — открыть в «Рабочем времени»`}
      onClick={() => openWeekOf(personKey(who))}>
      <span className="fold-title">Часы работы</span>
      <span className="fold-meta num">{summary}</span>
      <span className="fold-chev" aria-hidden="true">›</span>
    </button>
  )
}
