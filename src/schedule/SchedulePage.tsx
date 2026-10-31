import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { addDays, dayTitle, minutesOf, minutesOfTime, somText, timeOf, todayIn, ZONE } from '../lib/time'
import { AppointmentPanel } from './AppointmentPanel'
import { DayList } from './DayList'
import { NewAppointmentPanel, type Slot } from './NewAppointmentPanel'
import { statusOf } from './status'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Сколько пикселей на минуту: час — 78 px; приём на 45 минут вмещает время, имя и статус. */
const PX = 1.3

/** Ниже этой высоты блок — одной строкой: время начала и имя. */
const SHORT = 46

/** Цвета аватаров врачей — по порядку, различимы рядом и на светлой, и на тёмной теме. */
const AVATARS = ['#0E8A80', '#5B7FD6', '#C2793B', '#8E5BB5', '#2F8F5B', '#C2506B']

function initials(name = ''): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

/** Минуты от полуночи «сейчас» по Бишкеку; обновляются раз в минуту — линия «сейчас» ползёт сама. */
function useNowMinutes(): number {
  const [now, setNow] = useState(() => minutesOf(new Date().toISOString()))
  useEffect(() => {
    const t = setInterval(() => setNow(minutesOf(new Date().toISOString())), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Отступ сверху и снизу сетки: подпись первого часа («09:00») не обрезается. */
const PAD = 10

/** Расписание само перечитывается раз в минуту: кто-то записал с телефона — видно без F5. */
const REFRESH_MS = 60_000

type Side = { kind: 'appointment'; id: number; fallback?: Appointment } | { kind: 'new'; slot: Slot; patient?: Schemas['PatientView']; walkIn?: boolean } | null

/** Узкий экран (телефон): там «День» списком, а не сетка колонок. */
function isNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches
}

/** Ширина экрана меняется (повернули телефон, сузили окно) — перерисовать. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 760px)')
    const onChange = () => setNarrow(query.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return narrow
}

/**
 * «Расписание»: день всех врачей колонками, как настольный календарь. Нажать на приём — карточка
 * справа с действиями; на пустое место — «Новая запись» на это время. Расписание остаётся на экране.
 */
export function SchedulePage({ me, bookPatient = null, onBookingShown, onNavigate, initialDate, openAppointment }: {
  me: Me
  /** Кнопка бота: «Открыть завтра» — сразу этот день; «Открыть приём» — его день и карточка. */
  initialDate?: string
  openAppointment?: Appointment
  /** Переход в другой раздел из полосы «Сегодня» (касса, склад). */
  onNavigate?: (page: Page) => void
  /** Пришли из «Пациентов» по «Записать»: сразу «Новая запись» на этого пациента. */
  bookPatient?: Schemas['PatientView'] | null
  onBookingShown?: () => void
}) {
  const today = todayIn()
  const [date, setDate] = useState(() => (openAppointment?.startAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(openAppointment.startAt)) : initialDate ?? today))
  const [side, setSide] = useState<Side>(() => {
    if (openAppointment) return { kind: 'appointment', id: openAppointment.id!, fallback: openAppointment }
    const doctor = (me.doctors ?? []).find((d) => d.id === me.doctorId && d.active !== false)
      ?? (me.doctors ?? []).find((d) => d.active !== false)
    return bookPatient && doctor
      ? { kind: 'new', patient: bookPatient, slot: { doctorId: doctor.id!, date: today, minutes: minutesOfTime(me.clinic?.workStart ?? '09:00') } }
      : null
  })
  // Пациента для записи взяли — забыть, чтобы при следующем заходе «Расписание» открылось как обычно
  useEffect(() => {
    if (bookPatient) onBookingShown?.()
  }, [bookPatient, onBookingShown])
  const close = useCallback(() => setSide(null), [])
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // Чьё расписание: все врачи колонками или один. Выбор запоминается на устройстве (только id врача —
  // не личные данные). По умолчанию на телефоне — свой врач, на компьютере — все
  const [view, setViewState] = useState<number | 'all'>(() => {
    try {
      const saved = localStorage.getItem('crm.schedule.view')
      if (saved === 'all') return 'all'
      if (saved && doctors.some((d) => String(d.id) === saved)) return Number(saved)
    } catch {
      // приватный режим
    }
    // На телефоне — один врач списком, как в прежнем приложении: свой, а у админа — первый
    if (!isNarrow()) return 'all'
    return doctors.find((d) => d.id === me.doctorId)?.id ?? doctors[0]?.id ?? 'all'
  })
  const setView = (next: number | 'all') => {
    setViewState(next)
    try {
      localStorage.setItem('crm.schedule.view', String(next))
    } catch {
      // приватный режим
    }
  }
  const shown = view === 'all' ? doctors : doctors.filter((d) => d.id === view)
  const narrow = useNarrow()
  // Один врач на телефоне — «День» списком (лента дней, свободные окна, «Принять сейчас»)
  const dayList = narrow && view !== 'all' && shown.length === 1 ? shown[0]! : null

  const days = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['appointments', date, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments', { params: { query: { date, doctorId: d.id! } } })),
      refetchInterval: REFRESH_MS,
    })),
  })

  const loaded = days.flatMap((q) => q.data ?? [])
  const all = loaded.filter((a) => a.status !== 'CANCELLED')
  // Карточка — всегда свежая версия приёма из кэша дня (после действий и автообновления)
  const selected = side?.kind === 'appointment' ? loaded.find((a) => a.id === side.id) ?? side.fallback ?? null : null
  // Сетка — часы клиники; приём раньше или позже — сетка растягивается до него
  let from = minutesOfTime(me.clinic?.workStart ?? '09:00')
  let to = minutesOfTime(me.clinic?.workEnd ?? '18:00')
  for (const a of all) {
    from = Math.min(from, Math.floor(minutesOf(a.startAt!) / 60) * 60)
    to = Math.max(to, Math.ceil(minutesOf(a.endAt!) / 60) * 60 || 24 * 60)
  }
  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from + i * 60)
  const height = (to - from) * PX + PAD * 2
  // Линия «сейчас» — только у сегодняшнего дня и внутри сетки; выше неё день приглушён
  const nowMinutes = useNowMinutes()
  const nowTop = date === today && nowMinutes >= from && nowMinutes <= to ? PAD + (nowMinutes - from) * PX : null

  // Полоса «Сегодня»: что требует действия — одним рядом (DESIGN.md → Components)
  const seesMoney = Boolean(me.admin && !me.clinic?.independentDoctors) || me.doctorId != null
  const toPay = useQuery({
    queryKey: ['to-pay'],
    queryFn: () => unwrap(api.GET('/api/appointments/to-pay')),
    enabled: Boolean(me.reception || me.hasReception),
  })
  const supplies = useQuery({
    queryKey: ['supplies', null],
    queryFn: () => unwrap(api.GET('/api/supplies')),
    staleTime: 5 * 60_000,
  })
  const moneyScope = me.admin && !me.clinic?.independentDoctors ? {} : { doctorId: me.doctorId ?? undefined }
  const revenue = useQuery({
    queryKey: ['revenue', date, date, me.admin && !me.clinic?.independentDoctors ? null : me.doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: date, to: date, ...moneyScope } } })),
    enabled: seesMoney,
  })
  const requests = all.filter((a) => a.status === 'REQUESTED')
  const waiting = all.filter((a) => a.status === 'SCHEDULED' && statusOf(a).kind === 'wait')
  const low = (supplies.data ?? []).filter((x) => x.low).length
  const firstOf = (list: Appointment[]) => () => {
    const first = [...list].sort((a, b) => (a.startAt! < b.startAt! ? -1 : 1))[0]
    if (first) setSide({ kind: 'appointment', id: first.id! })
  }

  /** Пустое место в колонке врача → «Новая запись» на это время, вниз до 15 минут. */
  const pick = (doctorId: number) => (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.appt')) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top - PAD
    const minutes = Math.min(Math.max(from + Math.floor(y / PX / 15) * 15, from), to - 15)
    setSide({ kind: 'new', slot: { doctorId, date, minutes } })
  }
  /** «Принять сейчас (без записи)» — к выбранному врачу или к себе; приём с этой минуты. */
  const walkInHere = () => {
    const first = (view === 'all' ? null : doctors.find((d) => d.id === view)) ?? doctors.find((d) => d.id === me.doctorId) ?? doctors[0]
    if (first) setSide({ kind: 'new', slot: { doctorId: first.id!, date: today, minutes: minutesOf(new Date().toISOString()) }, walkIn: true })
  }
  const newHere = () => {
    const first = (view === 'all' ? null : doctors.find((d) => d.id === view)) ?? doctors.find((d) => d.id === me.doctorId) ?? doctors[0]
    if (first) setSide({ kind: 'new', slot: { doctorId: first.id!, date, minutes: minutesOfTime(me.clinic?.workStart ?? '09:00') } })
  }

  return (
    <div className={side ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        <header className="toolbar">
          <div className="day-switch">
            <button type="button" className="btn ghost" aria-label="Предыдущий день" onClick={() => setDate(addDays(date, -1))}>‹</button>
            <button type="button" className="btn ghost" aria-label="Следующий день" onClick={() => setDate(addDays(date, 1))}>›</button>
          </div>
          <div className="day-title">
            <h1>{dayTitle(date)}</h1>
            <span className="hint">
              {date === today ? 'сегодня · ' : ''}{all.length ? `Записей: ${all.length}` : 'Записей нет'}
              {doctors.length > 1 ? ` · врачей ${doctors.length}` : ''}
            </span>
          </div>
          {date !== today && <button type="button" className="btn" onClick={() => setDate(today)}>Сегодня</button>}
          <input type="date" aria-label="Выбрать дату" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {doctors.length > 0 && <button type="button" className="btn primary push" onClick={newHere}>＋ Новая запись</button>}
          {doctors.length > 0 && date === today && !dayList && (me.admin || me.reception || me.doctorId != null) && (
            <button type="button" className="btn" onClick={walkInHere}>Принять сейчас</button>
          )}
        </header>

        <div className="today-strip" role="group" aria-label="Требует внимания">
          {requests.length > 0 && (
            <button type="button" className="stat s-request" onClick={firstOf(requests)}>
              <b>{requests.length}</b> {requests.length === 1 ? 'заявка из бота' : 'заявки из бота'} — подтвердить
            </button>
          )}
          {waiting.length > 0 && (
            <button type="button" className="stat s-wait" onClick={firstOf(waiting)}>
              <b>{waiting.length}</b> ждём ответа на напоминание
            </button>
          )}
          {(toPay.data?.length ?? 0) > 0 && (
            <button type="button" className="stat s-cashier" onClick={() => onNavigate?.('cash')}>
              <b>{toPay.data!.length}</b> ждут оплаты на кассе
            </button>
          )}
          {revenue.data && (
            <button type="button" className="stat s-quiet" onClick={() => onNavigate?.('cash')}>
              <b>{somText(revenue.data.totalSom ?? 0).replace(' сом', '')}</b> сом {date === today ? 'сегодня' : 'за день'}
            </button>
          )}
          {low > 0 && (
            <button type="button" className="stat s-wait" onClick={() => onNavigate?.('stock')}>
              <b>{low}</b> на складе заканчивается
            </button>
          )}
          {!requests.length && !waiting.length && !toPay.data?.length && !low && (
            <span className="stat s-quiet calm">Всё под контролем: заявок и срочных дел нет</span>
          )}
        </div>

        {doctors.length > 1 && (
          <div className="segments tabs doctor-switch" role="group" aria-label="Чьё расписание">
            <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>Все врачи</button>
            {doctors.map((d) => (
              <button key={d.id} type="button" aria-pressed={view === d.id} onClick={() => setView(d.id!)}>
                {d.fullName}{d.id === me.doctorId ? ' (я)' : ''}
              </button>
            ))}
          </div>
        )}

        {dayList ? (
          <DayList me={me} doctorId={dayList.id!} date={date} onDate={setDate} selectedId={selected?.id}
            onOpen={(a) => setSide({ kind: 'appointment', id: a.id!, fallback: a })}
            onNew={(minutes, walkIn) => setSide({ kind: 'new', slot: { doctorId: dayList.id!, date: walkIn ? today : date, minutes }, walkIn })} />
        ) : doctors.length === 0 ? (
          <p className="hint">В клинике пока нет врачей — добавьте их в приложении: «Меню → Врачи».</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: `56px repeat(${shown.length}, minmax(180px, 1fr))`, '--cols': shown.length } as CSSProperties}>
            <div className="grid-corner" />
            {shown.map((d) => (
              <div key={d.id} className="grid-head" title={d.fullName}>
                <span className="avatar" style={{ background: AVATARS[doctors.indexOf(d) % AVATARS.length] }} aria-hidden="true">{initials(d.fullName)}</span>
                <span className="grid-head-name">{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</span>
              </div>
            ))}
            <div className="grid-times" style={{ height }}>
              {/* Час рядом с меткой «сейчас» прячем — иначе «11:00» и «11:10» наезжают друг на друга */}
              {hours.filter((m) => nowTop == null || Math.abs(m - nowMinutes) > 15).map((m) => (
                <span key={m} className="num" style={{ top: PAD + (m - from) * PX }}>{String(Math.floor(m / 60)).padStart(2, '0')}:00</span>
              ))}
              {nowTop != null && <span className="now-label num" style={{ top: nowTop }}>{timeOf(new Date().toISOString())}</span>}
            </div>
            {shown.map((d) => {
              const q = days[doctors.indexOf(d)]
              return (
                <div key={d.id} className="grid-col" style={{ height }} role="group" aria-label={d.fullName}
                  title="Нажмите на свободное время — новая запись" onClick={pick(d.id!)}>
                  {hours.map((m) => <div key={m} className="grid-hour" style={{ top: PAD + (m - from) * PX }} />)}
                  {nowTop != null && <div className="grid-past" style={{ height: nowTop }} />}
                  {nowTop != null && <div className="grid-now" style={{ top: nowTop }} />}
                  {q?.isPending && <div className="hint grid-loading">Загрузка…</div>}
                  {q?.error && <div className="error grid-loading">{q.error.message}</div>}
                  {(q?.data ?? []).filter((a) => a.status !== 'CANCELLED').map((a) => {
                    const s = statusOf(a)
                    const top = PAD + (minutesOf(a.startAt!) - from) * PX
                    const h = Math.max((minutesOf(a.endAt!) - minutesOf(a.startAt!)) * PX - 2, 22)
                    const short = h < SHORT
                    return (
                      <button key={a.id} type="button" className={`appt s-${s.kind}${short ? ' short' : ''}${selected?.id === a.id ? ' active' : ''}`}
                        style={{ top, height: h }} onClick={() => setSide({ kind: 'appointment', id: a.id! })}
                        aria-label={`${timeOf(a.startAt!)}–${timeOf(a.endAt!)}, ${a.patient?.fullName}: ${s.label}`}>
                        <span className="appt-time num">{short ? timeOf(a.startAt!) : `${timeOf(a.startAt!)}–${timeOf(a.endAt!)}`}</span>
                        <span className="appt-name">{a.patient?.fullName}</span>
                        {/* Статус словом и у короткого приёма: цвет без слова не читается (FINDING-002) */}
                        {(short || h > 56) && <span className="appt-state"><span className="dot" /> {s.label}</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </section>
      {selected && <AppointmentPanel appointment={selected} me={me} onClose={close} />}
      {side?.kind === 'new' && (
        <NewAppointmentPanel slot={side.slot} me={me} initialPatient={side.patient} walkIn={side.walkIn} onClose={close}
          onCreated={(a) => setSide({ kind: 'appointment', id: a.id!, fallback: a })} />
      )}
    </div>
  )
}
