import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { SetupChecklist } from '../clinic/SetupChecklist'
import { openSettings, type Page } from '../lib/route'
import { addDays, dayTitle, minutesOf, minutesOfTime, nowMinutes5, somText, timeOf, todayIn, ZONE } from '../lib/time'
import { MedicalRecord } from '../medical/MedicalRecord'
import { AppointmentPanel } from './AppointmentPanel'
import { DayList } from './DayList'
import { DoctorPicker } from './DoctorPicker'
import { AVATARS, initials } from '../lib/avatars'
import { NewAppointmentPanel, type Slot } from './NewAppointmentPanel'
import { statusOf } from './status'
import { canEditDoctor, isAssistant, seesMoneyOf, seesToPay } from '../lib/roles'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Сколько пикселей на минуту: час — 78 px; приём на 45 минут вмещает время, имя и статус. */
const PX = 1.3

/** Ниже этой высоты блок — одной строкой: время начала и имя. */
const SHORT = 46


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
const PAD = 14

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
export function SchedulePage({ me, bookPatient = null, onBookingShown, onNavigate, initialDate, initialDoctor, openAppointment, onOpenPatient }: {
  /** Кнопка бота «приёмы коллеги» (?doctor=ID): сразу этот врач. */
  initialDoctor?: number
  me: Me
  /** Имя пациента в карточке приёма → его карточка в «Пациентах». */
  onOpenPatient?: (patientId: number) => void
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
  // Медкарта пациента во всю рабочую область — открыта с приёма; «Назад» вернёт к этому приёму
  const [medical, setMedical] = useState<{ patient: Schemas['PatientView']; from: number } | null>(null)
  const [side, setSide] = useState<Side>(() => {
    if (openAppointment) return { kind: 'appointment', id: openAppointment.id!, fallback: openAppointment }
    const doctor = (me.doctors ?? []).find((d) => d.id === me.doctorId && d.active !== false)
      ?? (me.doctors ?? []).find((d) => d.active !== false && canEditDoctor(me, d.id))
    return bookPatient && doctor
      // Время не подставляем: открытие клиники могло пройти или быть занято — сетка свободного покажет, что есть
      ? { kind: 'new', patient: bookPatient, slot: { doctorId: doctor.id!, date: today, minutes: null } }
      : null
  })
  // Пациента для записи взяли — забыть, чтобы при следующем заходе «Расписание» открылось как обычно
  useEffect(() => {
    if (bookPatient) onBookingShown?.()
  }, [bookPatient, onBookingShown])
  const close = useCallback(() => setSide(null), [])
  // Ассистент видит только своих врачей (V68): чужие расписания ему не нужны
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id!)))
  // Чьё расписание: все врачи колонками или один. Выбор запоминается на устройстве (только id врача —
  // не личные данные). По умолчанию на телефоне — свой врач, на компьютере — все
  const [view, setViewState] = useState<number | 'all'>(() => {
    if (initialDoctor && doctors.some((d) => d.id === initialDoctor)) return initialDoctor
    // Телефон — как в прежнем приложении: каждый раз открывается свой день
    if (isNarrow() && doctors.some((d) => d.id === me.doctorId)) return me.doctorId!
    if (isNarrow() && isAssistant(me) && doctors[0]) return doctors[0].id!
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
  // Телефон — всегда «День» списком (как в прежнем приложении): один врач или «Все врачи» вместе
  const dayList = narrow && shown.length > 0 ? shown : null

  const days = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['appointments', date, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments', { params: { query: { date, doctorId: d.id! } } })),
      refetchInterval: REFRESH_MS,
    })),
  })

  // Часы врача, перерывы и выходной — тот же ответ, что у «Дня» на телефоне (кэш общий)
  const slots = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['slots', date, d.id],
      queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId: d.id! } } })),
      staleTime: 60_000,
      enabled: !dayList,
    })),
  })

  const loaded = days.flatMap((q) => q.data ?? [])
  const all = loaded.filter((a) => a.status !== 'CANCELLED')
  // Карточка — всегда свежая версия приёма: из кэша дня (после действий и автообновления), а приём,
  // перенесённый на другой день, — из ответа на действие (useAppointmentAction кладёт его в ['appointment', id])
  const openedId = side?.kind === 'appointment' ? side.id : null
  const lastAction = useQuery({
    queryKey: ['appointment', openedId],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}', { params: { path: { id: openedId! } } })),
    enabled: false,
  })
  const selected = side?.kind === 'appointment'
    ? loaded.find((a) => a.id === side.id) ?? lastAction.data ?? side.fallback ?? null : null
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
  // Открыли день — сетка сама к «сейчас» (сегодня) или к первому приёму; один раз на день
  const grid = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  const ready = days.length > 0 && days.every((q) => !q.isPending)
  const firstTop = all.length ? PAD + (Math.min(...all.map((a) => minutesOf(a.startAt!))) - from) * PX : null
  useEffect(() => {
    if (!ready || !grid.current || scrolledFor.current === date) return
    scrolledFor.current = date
    const target = nowTop ?? firstTop
    if (target != null) grid.current.scrollTop = Math.max(0, target - 80)
  }, [ready, date, nowTop, firstTop])

  // Полоса «Сегодня»: что требует действия — одним рядом (DESIGN.md → Components)
  const seesMoney = Boolean(me.admin && !me.clinic?.independentDoctors) || me.doctorId != null
  const toPay = useQuery({
    queryKey: ['to-pay'],
    queryFn: () => unwrap(api.GET('/api/appointments/to-pay')),
    enabled: seesToPay(me),
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
    // Расписание коллеги — только просмотр: записать к нему может он сам, регистратура или админ
    if (!canEditDoctor(me, doctorId)) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top - PAD
    const minutes = Math.min(Math.max(from + Math.floor(y / PX / 15) * 15, from), to - 15)
    setSide({ kind: 'new', slot: { doctorId, date, minutes } })
  }
  // К кому записать с кнопки: выбранный врач, если его расписание можно менять, иначе свой, иначе первый доступный
  const bookable = doctors.filter((d) => canEditDoctor(me, d.id))
  const firstBookable = () => (view === 'all' ? null : bookable.find((d) => d.id === view)) ?? bookable.find((d) => d.id === me.doctorId) ?? bookable[0]
  /** «Принять сейчас (без записи)» — к выбранному врачу или к себе; приём с этой минуты (вниз до 5 минут). */
  const walkInHere = () => {
    const first = firstBookable()
    if (first) setSide({ kind: 'new', slot: { doctorId: first.id!, date: today, minutes: nowMinutes5() }, walkIn: true })
  }
  const newHere = () => {
    const first = firstBookable()
    // Без времени: в форме — сетка свободного, а не 09:00, которое могло пройти или быть занято
    if (first) setSide({ kind: 'new', slot: { doctorId: first.id!, date, minutes: null } })
  }

  if (medical) {
    return (
      <div className="schedule">
        <MedicalRecord patient={medical.patient} backLabel="← К приёму" readOnly={isAssistant(me)}
          onBack={() => { setSide({ kind: 'appointment', id: medical.from }); setMedical(null) }} />
      </div>
    )
  }

  return (
    <div className={side ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        {/* Телефон: без заголовка дня — день выбирают в ленте (там же месяц и «📅 другой день») */}
        {!dayList && (
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
            {bookable.length > 0 && <button type="button" className="btn primary push" onClick={newHere}>＋ Новая запись</button>}
            {bookable.length > 0 && date === today && (
              <button type="button" className="btn" onClick={walkInHere}>Принять сейчас</button>
            )}
          </header>
        )}

        <SetupChecklist me={me} />
        {!dayList && (
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
        )}

        {/* Телефон: только то, что нужно сделать сейчас, — заявки и оплата на кассе. «Ждём ответа» видно в строках
            дня, «склад: мало» — в «Складе» и сообщением бота: на главной это было лишнее */}
        {dayList && (requests.length > 0 || (toPay.data?.length ?? 0) > 0) && (
          <div className="today-strip compact" role="group" aria-label="Требует внимания">
            {requests.length > 0 && (
              <button type="button" className="stat s-request" onClick={firstOf(requests)}>
                <b>{requests.length}</b> {requests.length === 1 ? 'заявка' : 'заявки'}
              </button>
            )}
            {(toPay.data?.length ?? 0) > 0 && (
              <button type="button" className="stat s-cashier" onClick={() => onNavigate?.('cash')}><b>{toPay.data!.length}</b> к оплате</button>
            )}
          </div>
        )}

        {doctors.length > 1 && (narrow || doctors.length > 4 ? (
          // Телефон (и много врачей на компьютере): один выпадающий список вместо ряда кнопок
          <DoctorPicker me={me} doctors={doctors} view={view} date={date} onChange={setView} />
        ) : (
          <div className="segments tabs doctor-switch" role="group" aria-label="Чьё расписание">
            <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>Все врачи</button>
            {doctors.map((d) => (
              <button key={d.id} type="button" aria-pressed={view === d.id} onClick={() => setView(d.id!)}>
                {d.fullName}{d.id === me.doctorId ? ' (я)' : ''}
              </button>
            ))}
          </div>
        ))}

        {dayList ? (
          <DayList me={me} doctors={dayList.map((d) => ({ id: d.id!, name: d.fullName ?? '' }))} date={date} onDate={setDate} selectedId={selected?.id}
            onNewHere={bookable.length > 0 ? newHere : undefined}
            onOpen={(a) => setSide({ kind: 'appointment', id: a.id!, fallback: a })}
            onNew={(doctorId, minutes, walkIn) => setSide({ kind: 'new', slot: { doctorId, date: walkIn ? today : date, minutes }, walkIn })} />
        ) : doctors.length === 0 ? (
          <p className="hint">В клинике пока нет врачей — <button type="button" className="link" onClick={() => openSettings('doctors')}>добавьте их в «Настройки → Врачи»</button>.</p>
        ) : (
          <div ref={grid} className="grid" style={{ gridTemplateColumns: `56px repeat(${shown.length}, minmax(180px, 1fr))`, '--cols': shown.length } as CSSProperties}>
            <div className="grid-corner" />
            {shown.map((d) => (
              <button key={d.id} type="button" className="grid-head" title={`Только ${d.fullName}`} disabled={shown.length === 1}
                onClick={() => setView(d.id!)}>
                <span className="avatar" style={{ background: AVATARS[doctors.indexOf(d) % AVATARS.length] }} aria-hidden="true">{initials(d.fullName)}</span>
                <span className="grid-head-name">{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</span>
              </button>
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
              const sl = slots[doctors.indexOf(d)]?.data
              const y = (minutes: number) => PAD + (Math.min(Math.max(minutes, from), to) - from) * PX
              const workFrom = sl?.workStart ? minutesOfTime(sl.workStart.slice(0, 5)) : null
              const workTo = sl?.workEnd ? minutesOfTime(sl.workEnd.slice(0, 5)) : null
              return (
                <div key={d.id} className="grid-col" style={{ height }} role="group" aria-label={d.fullName}
                  title={canEditDoctor(me, d.id) ? 'Нажмите на свободное время — новая запись' : 'Расписание коллеги — только просмотр'} onClick={pick(d.id!)}>
                  {hours.map((m) => <div key={m} className="grid-hour" style={{ top: PAD + (m - from) * PX }} />)}
                  {nowTop != null && <div className="grid-past" style={{ height: nowTop }} />}
                  {sl && !sl.workingDay && (
                    <div className="grid-off" style={{ top: 0, height }}><span>{sl.dayOff ? `${sl.dayOff.emoji ?? ''} ${sl.dayOff.title ?? ''}` : 'Выходной'}</span></div>
                  )}
                  {sl?.workingDay && workFrom != null && workFrom > from && <div className="grid-off" style={{ top: 0, height: y(workFrom) }} />}
                  {sl?.workingDay && workTo != null && workTo < to && <div className="grid-off" style={{ top: y(workTo), height: height - y(workTo) }} />}
                  {(sl?.breaks ?? []).map((b) => (
                    <div key={b.start} className="grid-break" style={{ top: y(minutesOf(b.start!)), height: Math.max(y(minutesOf(b.end!)) - y(minutesOf(b.start!)), 14) }}
                      title={`${timeOf(b.start!)}–${timeOf(b.end!)} ${b.title ?? ''}`}>
                      <span>{b.emoji} {b.title}</span>
                    </div>
                  ))}
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
                        {(short || h > 56) && <span className="appt-state"><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}</span>}
                        {h > 80 && a.comment && <span className="appt-note">{a.comment}</span>}
                        {h > 80 && a.depositStatus && seesMoneyOf(me, a.doctorId) && ['REQUESTED', 'SCHEDULED'].includes(a.status ?? '') && (
                          <span className="appt-note">Предоплата {a.depositStatus === 'RECEIVED' ? 'получена' : a.depositStatus === 'REPORTED' ? '— проверьте' : '— ждём'}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </section>
      {/* key: другой приём — новая карточка, формы и «Вернуть» прежнего не переносятся */}
      {selected && <AppointmentPanel key={selected.id} appointment={selected} me={me} onClose={close} onOpenPatient={onOpenPatient}
        onMedical={(patient) => setMedical({ patient, from: selected.id! })}
        onBook={(slot, patient) => setSide({ kind: 'new', slot, patient })} />}
      {side?.kind === 'new' && (
        <NewAppointmentPanel slot={side.slot} me={me} initialPatient={side.patient} walkIn={side.walkIn} onClose={close}
          onCreated={(a) => setSide({ kind: 'appointment', id: a.id!, fallback: a })} />
      )}
    </div>
  )
}
