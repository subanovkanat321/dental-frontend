import { useInfiniteQuery } from '@tanstack/react-query'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { Loading, Spinner } from '../layout/Loading'
import { timeOf } from '../lib/time'
import { TIMELINE_ICON, timelineDay, timelineSub, timelineText, timelineWho, type TimelineItem } from './timeline'

type Page = Schemas['PatientTimelinePage']

/** Сколько строк за раз: неделя-другая жизни обычного пациента. */
const PAGE = 30

/**
 * «История» в карточке пациента — живая лента (шаг 8А): что было с пациентом, новое сверху, по дням. Строка — значок,
 * короткий текст, под ним серым услуга и врач; справа время по Бишкеку и кто сделал. Строка с приёмом — кнопка: откроет
 * карточку приёма. Медицинского сервер в ленту не кладёт, деньги — только тем, кто их видит.
 */
export function PatientHistory({ patientId, onOpenAppointment }: { patientId: number; onOpenAppointment?: (id: number) => void }) {
  const list = useInfiniteQuery<Page, ApiError>({
    queryKey: ['patient-timeline', patientId],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/patients/{patientId}/timeline', {
      params: { path: { patientId }, query: { limit: PAGE, before: (pageParam as string | null) ?? undefined } },
    })),
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
  })
  if (list.isPending) return <Loading />
  if (list.error) return <p className="error" role="alert">{list.error.message}</p>
  const items = list.data.pages.flatMap((p) => p.items)
  if (!items.length) return <EmptyState compact title="Пока ничего не происходило" />
  // По дням: заголовок дня один раз, в строке — только время
  const days: { day: string; items: TimelineItem[] }[] = []
  for (const item of items) {
    const day = timelineDay(item.at)
    if (days.at(-1)?.day !== day) days.push({ day, items: [] })
    days.at(-1)!.items.push(item)
  }
  return (
    <section className="patient-history" aria-label="История пациента">
      {days.map(({ day, items: rows }) => (
        <div key={day} className="history-day">
          <h3 className="history-date">{day}</h3>
          <ul className="history-list">
            {rows.map((i) => <HistoryRow key={i.key} item={i} onOpenAppointment={onOpenAppointment} />)}
          </ul>
        </div>
      ))}
      {list.hasNextPage && (
        <button type="button" className="btn history-more" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? <><Spinner />Загрузка…</> : 'Показать ещё'}</button>
      )}
    </section>
  )
}

function HistoryRow({ item, onOpenAppointment }: { item: TimelineItem; onOpenAppointment?: (id: number) => void }) {
  const sub = timelineSub(item)
  const who = timelineWho(item)
  const body = (
    <>
      <span className="history-ico" aria-hidden="true">{TIMELINE_ICON[item.kind]}</span>
      <span className="history-main">
        <span className="history-text">{timelineText(item)}</span>
        {sub && <span className="history-sub">{sub}</span>}
      </span>
      <span className="history-meta">
        <span className="num">{timeOf(item.at)}</span>
        {who && <span className="history-who">{who}</span>}
      </span>
    </>
  )
  const open = item.appointmentId != null && onOpenAppointment ? item.appointmentId : null
  return (
    <li className={`history-row k-${item.kind.toLowerCase().replace(/_/g, '-')}`}>
      {open != null
        ? <button type="button" className="history-link" onClick={() => onOpenAppointment!(open)}>{body}</button>
        : <span className="history-link">{body}</span>}
    </li>
  )
}
