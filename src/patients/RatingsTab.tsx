import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { Loading, Spinner } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { Segments } from '../layout/Segments'
import { DoctorFilter } from '../layout/DoctorFilter'
import { doctorOptions } from '../layout/doctorOptions'
import { myDoctorDefault, seesAllMoney } from '../lib/roles'
import { shortDate } from '../lib/time'
import { CalmRow } from './CalmList'
import { averageText, LONG_COMPLAINT, lowCount } from './ratings'

type Me = Schemas['BookingViewsMe']
type Page = Schemas['RatingList']

const PERIODS: [string, string][] = [['30', '30 дней'], ['90', '90 дней'], ['365', 'Год']]

/** Подсказка пустого списка — та же, что в «Касса → Статистика». */
export function AskForRatings() {
  return <>На следующий день после приёма бот спросит оценку у тех, кто записывался через бота. Пациентов без Telegram —
    «⭐ Попросить оценку» в карточке приёма.</>
}

/**
 * «Пациенты → Оценки»: кто какую оценку поставил после приёма, новые сверху. Сверху — сводка за период (средняя, сколько,
 * сколько 1–3 ★); фильтры — период, врач (руководителю) и «Только 1–3 ★»; по 50 — «Показать ещё». Чьи оценки видно,
 * решает сервер (руководитель и регистратура — всех, ассистент — своих врачей, врач — свои). Строка открывает приём.
 */
export function RatingsTab({ me, onOpenAppointment, onOpenPatient }: {
  me: Me
  onOpenAppointment?: (appointmentId: number) => void
  onOpenPatient: (patientId: number) => void
}) {
  const [days, setDays] = useState('90')
  const [low, setLow] = useState(false)
  // Выбор врача — у руководителя, который видит всех врачей (остальным сервер и так отдаёт только их приёмы)
  const doctors = seesAllMoney(me) ? (me.doctors ?? []).filter((d) => d.active !== false) : []
  const [doctorId, setDoctorId] = useState<number | null>(() => myDoctorDefault(me, doctors.map((d) => d.id)))
  const list = useInfiniteQuery<Page, ApiError>({
    queryKey: ['ratings', 'list', days, doctorId, low],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/appointments/ratings/list', {
      params: { query: { days: Number(days), doctorId: doctorId ?? undefined, low, page: pageParam as number } },
    })),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.more ? pages.length : undefined),
    // Сменили фильтр — прежний список на экране, пока грузится новый
    placeholderData: keepPreviousData,
  })
  const summary = list.data?.pages[0]?.summary
  const rows = list.data?.pages.flatMap((p) => p.items ?? []) ?? []
  const open = (r: Schemas['RatingRow']) => (onOpenAppointment ? onOpenAppointment(r.appointmentId) : onOpenPatient(r.patientId))

  return (
    <div className="calm-stack ratings">
      <SubHelp title="Оценки">Оценки пациентов после приёма: из бота и по ссылке из WhatsApp. «Только 1–3 ★» — жалобы, на которые стоит
        ответить: позвоните пациенту. Нажмите на строку — откроется приём.</SubHelp>
      <HeadTools>
        <Segments label="Период" value={days} onChange={setDays} options={PERIODS.map(([value, label]) => ({ value, label }))} />
        {doctors.length > 1 && (
          <DoctorFilter label="Врач" value={doctorId} onChange={setDoctorId} options={doctorOptions(doctors, { me })} />
        )}
        <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Только 1–3 ★</label>
      </HeadTools>
      {list.error && <p className="error" role="alert">{list.error.message}</p>}
      {list.isPending ? <Loading /> : summary && !summary.count ? (
        <EmptyState fill title="Оценок пока нет"><AskForRatings /></EmptyState>
      ) : (
        <>
          {summary && (
            <section className="card-block rating-summary" aria-label="Сводка оценок">
              <p className="total"><span aria-label="Средняя оценка">{averageText(summary)}</span><span className="hint small"> из 5</span></p>
              <p className="rating-counts">
                <span>Оценок: <b className="num">{summary.count}</b></span>
                <span className={lowCount(summary) ? 'tone-bad' : undefined}>С жалобой (1–3 ★): <b className="num">{lowCount(summary)}</b></span>
                {summary.fromPage > 0 && <span className="hint">по ссылке: <span className="num">{summary.fromPage}</span></span>}
              </p>
            </section>
          )}
          {!rows.length ? <EmptyState title="Жалоб за этот период нет">Все оценки — 4 и 5 ★.</EmptyState> : (
            <ul className="calm-list" aria-label="Оценки пациентов">
              {rows.map((r) => (
                <CalmRow key={r.appointmentId} open={() => open(r)} name={r.patientName}
                  sub={[r.startAt ? shortDate(r.startAt) : null, r.doctorName, r.via === 'PAGE' ? 'по ссылке' : 'в боте'].filter(Boolean).join(' · ')}
                  meta={<Stars rating={r.rating} />}>
                  {r.comment && <Complaint text={r.comment} />}
                </CalmRow>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <button type="button" className="btn" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? <><Spinner />Загрузка…</> : 'Показать ещё'}</button>
          )}
        </>
      )}
    </div>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className={`rating-stars${rating <= 3 ? ' low' : ''}`} aria-label={`Оценка ${rating} из 5`}>
      {'★'.repeat(rating)}<span className="rating-off">{'★'.repeat(5 - rating)}</span>
    </span>
  )
}

/**
 * Что пациент написал после 1–3 ★: не помещается в две строки — свёрнуто, нажатие раскрывает (и сворачивает).
 * Помещается ли — меряем в браузере (на широком экране длинный текст бывает в одну строку — тогда без «полностью»);
 * где мерить нечем (тесты, jsdom) — по длине текста.
 */
function Complaint({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(text.length > LONG_COMPLAINT)
  const box = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (open || !el || !el.clientHeight) return
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [open, text, long])
  const body = <span ref={box} className="rating-complaint-text">{text}</span>
  if (!long && !open) return <p className="rating-complaint">{body}</p>
  return (
    <button type="button" className={`rating-complaint long${open ? ' open' : ''}`} aria-expanded={open}
      title={open ? 'Свернуть' : 'Показать полностью'} onClick={() => setOpen(!open)}>
      {body}
      <span className="link">{open ? 'свернуть' : 'полностью'}</span>
    </button>
  )
}
