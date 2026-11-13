import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { SetupChecklist } from '../clinic/SetupChecklist'
import { openClinic, type Page } from '../lib/route'
import { addDays, dateOf, dayMinutes, dayTitle, emptyDayText, minutesOf, minutesOfTime, somText, timeOf, todayIn, weekLabel, weekStart, ZONE } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { MedicalRecord } from '../medical/MedicalRecord'
import { AppointmentPanel } from './AppointmentPanel'
import { BadgesLegend } from './ApptBadges'
import { DayAppt } from './DayAppt'
import { DayList } from './DayList'
import { CancelledList } from './CancelledList'
import { ChairTimeBands } from './ChairTimeBands'
import { DaySummary } from './DaySummary'
import { freeMinutes } from './free'
import { DateInput } from '../layout/DateInput'
import { useMedia } from '../lib/useMedia'
import { DoctorPicker } from './DoctorPicker'
import { DoctorOrderDialog } from './DoctorOrderDialog'
import { orderDoctors, useDoctorOrder } from './doctorOrder'
import { useHiddenDoctors, visibleDoctors } from './doctorVisibility'
import { OffDaysHint } from './OffDaysHint'
import './doctorChips.css'
import { colorOf as doctorColor, initials, specialtyOf } from '../lib/avatars'
import { NewAppointmentPanel, type Slot } from './NewAppointmentPanel'
import { DAY, fromYesterday, gridRange, hourLabel, offSpans, slotsHoursText, workSpans } from './workSpans'
import { statusOf } from './status'
import { PAD, PX, useFitToWindow, useNowMinutes } from './gridScale'
import { useToolbarFit } from './useToolbarFit'
import { useWeekAppointments } from './week/useWeek'
import { WeekGrid } from './week/WeekGrid'
import { useEarnings } from '../earnings/earnings'
import { EarningsChip } from '../earnings/EarningsWidgets'
import { canEditDoctor, isAssistant, seesMoneyOf, seesToPay, seesAllMoney } from '../lib/roles'
import { HelpHint } from '../help/HelpHint'
import { Icon } from '../layout/Icon'
import { useApptHover } from './useApptHover'
import { ChairBadge } from '../team/ChairBadge'
import { useChairs } from '../team/chairs'
import { MonthGrid } from './month/MonthGrid'
import { addMonths, monthTitle } from './month/monthModel'
import { useMonthData } from './month/useMonth'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Расписание само перечитывается раз в минуту: кто-то записал с телефона — видно без F5. */
const REFRESH_MS = 60_000

type Side = { kind: 'appointment'; id: number; fallback?: Appointment } | { kind: 'new'; slot: Slot; patient?: Schemas['PatientView'] } | null

/** Узкий экран (телефон): там «День» списком, а не сетка колонок. */
function isNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches
}

type Mode = 'day' | 'week' | 'month'

/** До стольких врачей на компьютере — ряд чипов; больше — одна кнопка «Врачи: 4 из 10 ▾» (DoctorPicker). */
const MAX_CHIPS = 6

/** «День», «Неделя» или «Месяц» — запоминается на устройстве (только слово, не личные данные). */
function useMode(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem('crm.schedule.mode')
      return saved === 'week' || saved === 'month' ? saved : 'day'
    } catch {
      return 'day'
    }
  })
  const change = (next: Mode) => {
    setMode(next)
    try {
      localStorage.setItem('crm.schedule.mode', next)
    } catch {
      // приватный режим
    }
  }
  return [mode, change]
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
/** Сводка дня справа открыта или скрыта — на этом устройстве (не персональные данные). */
const SUMMARY_KEY = 'crm.daySummary'

export function SchedulePage({ me, bookPatient = null, bookPreset, onBookingShown, onNavigate, onOpenEarnings, initialDate, initialDoctor, openAppointment, onOpenPatient }: {
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
  /** «Мой заработок» врача → «Касса → Мой заработок». */
  onOpenEarnings?: () => void
  /** Пришли из «Пациентов» по «Записать»: сразу «Новая запись» на этого пациента. */
  bookPatient?: Schemas['PatientView'] | null
  /** Вместе с bookPatient: врач, услуга и длительность (из «Позвать снова → Отменили») */
  bookPreset?: { doctorId?: number; serviceId?: number; duration?: number }
  onBookingShown?: () => void
}) {
  const today = todayIn()
  const [date, setDate] = useState(() => (openAppointment?.startAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(openAppointment.startAt)) : initialDate ?? today))
  // Медкарта пациента во всю рабочую область — открыта с приёма; «Назад» вернёт к этому приёму
  const [medical, setMedical] = useState<{ patient: Schemas['PatientView']; from: number } | null>(null)
  const [side, setSide] = useState<Side>(() => {
    if (openAppointment) return { kind: 'appointment', id: openAppointment.id, fallback: openAppointment }
    // Врач отменённой записи (если к нему можно записать), иначе — свой
    const doctor = (me.doctors ?? []).find((d) => d.id === bookPreset?.doctorId && d.active !== false && canEditDoctor(me, d.id))
      ?? (me.doctors ?? []).find((d) => d.id === me.doctorId && d.active !== false)
      ?? (me.doctors ?? []).find((d) => d.active !== false && canEditDoctor(me, d.id))
    return bookPatient && doctor
      // Время не подставляем: открытие клиники могло пройти или быть занято — сетка свободного покажет, что есть
      ? { kind: 'new', patient: bookPatient, slot: { doctorId: doctor.id, date: today, minutes: null, duration: bookPreset?.duration, serviceId: bookPreset?.serviceId } }
      : null
  })
  // Пациента для записи взяли — забыть, чтобы при следующем заходе «Расписание» открылось как обычно
  useEffect(() => {
    if (bookPatient) onBookingShown?.()
  }, [bookPatient, onBookingShown])
  const close = useCallback(() => setSide(null), [])
  // Ассистент видит только своих врачей (V68): чужие расписания ему не нужны
  const clinicDoctors = (me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id)))
  // Порядок колонок, чипов и выбора врача: свой на устройстве (окно «Порядок врачей»), а если его нет —
  // свой врач первым: третьему врачу на телефоне не листать вбок до своей колонки
  const [doctorOrder, setDoctorOrder] = useDoctorOrder()
  const [ordering, setOrdering] = useState(false)
  const doctors = orderDoctors(clinicDoctors, doctorOrder, me.doctorId)
  // Цвет врача — по списку клиники, не по порядку на экране: поменяли порядок — цвета не перепутались
  const colorOf = (d: (typeof doctors)[number]) => doctorColor(clinicDoctors, d.id)
  // Чьё расписание: все врачи колонками или один. Выбор запоминается на устройстве (только id врача —
  // не личные данные). По умолчанию на телефоне — свой врач, на компьютере — все
  const [view, setViewState] = useState<number | 'all'>(() => {
    if (initialDoctor && doctors.some((d) => d.id === initialDoctor)) return initialDoctor
    // Телефон — как в прежнем приложении: каждый раз открывается свой день
    if (isNarrow() && doctors.some((d) => d.id === me.doctorId)) return me.doctorId!
    if (isNarrow() && isAssistant(me) && doctors[0]) return doctors[0].id
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
  // Кто колонкой в «Все врачи»: без скрытых в окне «Врачи в расписании» (на этом устройстве) и без тех,
  // у кого сегодня выходной и нет приёмов (ниже, когда загружены часы). Один врач — всегда он, даже скрытый
  const [hiddenDoctors, setHiddenDoctors] = useHiddenDoctors()
  const visible = visibleDoctors(doctors, hiddenDoctors)
  // «показать» у подсказки «Выходной: …» — до смены дня: запоминаем день, на который нажали
  const [offShownFor, setOffShownFor] = useState<string | null>(null)
  const narrow = useNarrow()
  // Один врач на телефоне — «День» списком (лента дней, свободные окна)
  // Телефон — всегда «День» списком (как в прежнем приложении): один врач или «Все врачи» вместе
  // «Неделя» — только на компьютере (от 1024px) и всегда один врач: семь дней × несколько врачей
  // не читаются, а перетаскивание между врачами и днями сразу легко промахнуться. «Все врачи» → свой врач или первый
  const [mode, setMode] = useMode()
  // «Месяц» — и на компьютере, и на телефоне (на телефоне ячейка — число дня и число записей); врач — выбранный или все
  const monthMode = mode === 'month' && doctors.length > 0 && !narrow
  const desktop = useMedia('(min-width: 1024px)')
  // Телефон — «День» списком (dayList ниже), «Недели» там нет
  const weekMode = mode === 'week' && desktop && !(narrow && !monthMode) && doctors.length > 0
  const weekDoctor = typeof view === 'number' && doctors.some((d) => d.id === view) ? view
    : (doctors.find((d) => d.id === me.doctorId) ?? doctors[0])?.id ?? null
  const monday = weekStart(date)
  const week = useWeekAppointments(monday, weekDoctor, weekMode)
  const month = date.slice(0, 7)
  // «Месяц» всех врачей считает записи всех, как заголовок дня, — скрытие касается только колонок «Дня»
  const monthData = useMonthData(month, (view === 'all' ? doctors : doctors.filter((d) => d.id === view)).map((d) => d.id), monthMode)
  const monthCount = monthData.appointments.filter((a) => a.status !== 'CANCELLED' && a.startAt && dateOf(a.startAt).startsWith(month)).length
  /** Другой месяц: сегодняшний день, если он в этом месяце, иначе 1-е число. */
  const goMonth = (m: string) => setDate(today.startsWith(m) ? today : `${m}-01`)

  const days = useQueries({
    queries: doctors.map((d) => ({
      // overnight — и приёмы со вчера, которые идут после полуночи (ночная смена): сетка рисует их хвост.
      // Свой ключ: «День» списком на телефоне берёт день без них (тот же префикс — действия обновляют оба).
      // Телефон — сетки нет, а «День» списком (DayList) просит день без хвостов: тот же запрос и ключ,
      // что у него, — один запрос на врача вместо двух
      queryKey: narrow ? ['appointments', date, d.id] : ['appointments', date, d.id, 'overnight'],
      queryFn: () => unwrap(api.GET('/api/appointments', { params: { query: narrow ? { date, doctorId: d.id } : { date, doctorId: d.id, overnight: true } } })),
      refetchInterval: REFRESH_MS,
      // В «Неделе» и «Месяце» дни не нужны: у них свой запрос на несколько дней
      enabled: !weekMode && !monthMode,
    })),
  })

  // Часы врача, перерывы и выходной — тот же ответ, что у «Дня» на телефоне (кэш общий)
  const slots = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['slots', date, d.id],
      queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId: d.id } } })),
      staleTime: 60_000,
      // Свободные окна в сетке меняются вместе с приёмами — обновлять так же
      refetchInterval: REFRESH_MS,
      // Телефон: «Все врачи» тоже — по ним видно, у кого выходной (кэш общий с «Днём» списком, лишних запросов нет)
      enabled: !weekMode && !monthMode && (!narrow || view === 'all'),
    })),
  })

  // Выходной врача — колонки нет: /api/slots говорит «не рабочий день», и приёмов у врача нет (с приёмом
  // колонка остаётся). Пока часы или приёмы не загружены — колонка есть: лучше лишняя, чем пропавший приём
  const dayOff = (d: (typeof doctors)[number]) => {
    const i = doctors.indexOf(d)
    const q = days[i]
    return slots[i]?.data?.workingDay === false && q?.isSuccess === true && !(q.data ?? []).some((a) => a.status !== 'CANCELLED')
  }
  const offToday = view === 'all' && !weekMode && !monthMode ? visible.filter(dayOff) : []
  // Выходной у всех — колонки остаются, как раньше («Выходной» в каждой): пустая сетка ничего не объяснит
  const offHidden = offToday.length < visible.length && offShownFor !== date ? offToday : []
  const shown = view === 'all' ? visible.filter((d) => !offHidden.includes(d)) : doctors.filter((d) => d.id === view)
  const dayList = narrow && !monthMode && shown.length > 0 ? shown : null
  // «показано 4 из 10» — когда колонок «Все врачи» меньше, чем врачей (скрыты или выходной)
  const partial = view === 'all' && shown.length < doctors.length ? `показано ${shown.length} из ${doctors.length}` : null
  const offHint = <OffDaysHint doctors={offHidden} onShow={() => setOffShownFor(date)} />

  // Приёмы этого дня; вчерашние через полночь — только в сетке (их считает вчерашний день)
  const withCarried = days.flatMap((q) => q.data ?? [])
  const loaded = withCarried.filter((a) => !fromYesterday(a, date))
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
    ? withCarried.find((a) => a.id === side.id) ?? week.data?.find((a) => a.id === side.id) ?? lastAction.data ?? side.fallback ?? null : null
  // Сетка — рабочие часы врачей на экране (а пока не загружены или все выходные — часы клиники), по
  // целым часам: без длинных пустых «хвостов» до полуночи. Приём раньше или позже — сетка растягивается до него
  // Рабочие отрезки — у ночной смены их два (00:00–08:00 и 18:00–24:00): сетка тогда на все сутки
  // Приём вечером через полночь (23:45–00:45) — сетка продлевается после 24:00 до его конца, не больше 4 часов (gridRange)
  const spans = shown.flatMap((d) => workSpans(slots[doctors.indexOf(d)]?.data, date))
  const { from, to, limit } = gridRange(spans,
    shown.flatMap((d) => days[doctors.indexOf(d)]?.data ?? []).filter((a) => a.status !== 'CANCELLED'), [date],
    [minutesOfTime(me.clinic?.workStart ?? '09:00'), minutesOfTime(me.clinic?.workEnd ?? '18:00')])
  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from + i * 60)
  const height = (to - from) * PX + PAD * 2
  // Линия «сейчас» — только у сегодняшнего дня и внутри сетки; выше неё день приглушён
  const nowMinutes = useNowMinutes()
  const nowTop = date === today && nowMinutes >= from && nowMinutes <= to ? PAD + (nowMinutes - from) * PX : null
  // Открыли день — сетка сама к «сейчас» (сегодня) или к первому приёму; один раз на день
  const grid = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  const ready = days.length > 0 && days.every((q) => !q.isPending) && (dayList != null || slots.every((q) => !q.isPending))
  const firstTop = all.length ? PAD + (Math.min(...all.map((a) => minutesOf(a.startAt))) - from) * PX : null
  // Сетка — до низа окна, где бы она ни начиналась (напоминания, строка врачей сверху)
  useFitToWindow(grid, `${date}|${shown.length}|${weekMode ? 'week' : monthMode ? 'month' : 'day'}`)
  const toolbar = useRef<HTMLElement>(null)
  // «Неделя» или «Месяц» — сетки дня нет: вернулись на «День» — сетка новая (прокрутка с 00:00), снова к «сейчас»
  const gridShown = !weekMode && !monthMode
  useEffect(() => {
    if (!gridShown) { scrolledFor.current = null; return }
    if (!ready || !grid.current || scrolledFor.current === date) return
    scrolledFor.current = date
    const target = nowTop ?? firstTop
    if (target != null) grid.current.scrollTop = Math.max(0, target - 80)
  }, [gridShown, ready, date, nowTop, firstTop])

  // Полоса «Сегодня»: что требует действия — одним рядом (DESIGN.md → Components)
  const seesMoney = seesAllMoney(me) || me.doctorId != null
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
  const moneyScope = seesAllMoney(me) ? {} : { doctorId: me.doctorId ?? undefined }
  const revenue = useQuery({
    queryKey: ['revenue', date, date, seesAllMoney(me) ? null : me.doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: date, to: date, ...moneyScope } } })),
    enabled: seesMoney,
  })
  // «Мой заработок» врача: компактно — чипом в полосе «Сегодня» или блоком в «Сводке дня»
  const earnings = useEarnings(me)
  const openEarnings = onOpenEarnings ?? (() => onNavigate?.('cash'))
  const requests = all.filter((a) => a.status === 'REQUESTED')
  const waiting = all.filter((a) => a.status === 'SCHEDULED' && statusOf(a).kind === 'wait')
  const low = (supplies.data ?? []).filter((x) => x.low).length
  const firstOf = (list: Appointment[]) => () => {
    const first = [...list].sort((a, b) => (a.startAt < b.startAt ? -1 : 1))[0]
    if (first) setSide({ kind: 'appointment', id: first.id })
  }

  /** Пустое место в колонке врача → «Новая запись» на это время, вниз до 15 минут. */
  const pick = (doctorId: number) => (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.appt, .grid-free, .grid-chair')) return
    // Расписание коллеги — только просмотр: записать к нему может он сам, регистратура или админ
    if (!canEditDoctor(me, doctorId)) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top - PAD
    const minutes = Math.min(Math.max(from + Math.floor(y / PX / 15) * 15, from), to - 15)
    // После полуночи (сетка продлена) — это уже следующий день
    setSide({ kind: 'new', slot: minutes >= DAY ? { doctorId, date: addDays(date, 1), minutes: minutes - DAY } : { doctorId, date, minutes } })
  }
  // К кому записать с кнопки: выбранный врач, если его расписание можно менять, иначе свой, иначе первый доступный
  const bookable = doctors.filter((d) => canEditDoctor(me, d.id))
  const firstBookable = () => (view === 'all' ? null : bookable.find((d) => d.id === view)) ?? bookable.find((d) => d.id === me.doctorId) ?? bookable[0]
  const newHere = () => {
    const first = firstBookable()
    // Без времени: в форме — сетка свободного, а не 09:00, которое могло пройти или быть занято
    if (first) setSide({ kind: 'new', slot: { doctorId: first.id, date, minutes: null } })
  }

  // Широкий экран: справа от сетки — сводка дня (кто следующий, что требует внимания, свободное время).
  // Открыли карточку приёма — она встаёт на это место; ноутбук поуже — сводка рядом над сеткой, как была
  const wide = useMedia('(min-width: 1280px)')
  // Сводка — по кнопке: при 4+ врачах по умолчанию скрыта, чтобы колонки врачей поместились; выбор помним
  const [summaryOpen, setSummaryOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SUMMARY_KEY)
      if (saved != null) return saved === '1'
    } catch { /* нет хранилища */ }
    return (me.doctors ?? []).filter((d) => d.active !== false).length <= 3
  })
  const toggleSummary = () => {
    const next = !summaryOpen
    setSummaryOpen(next)
    try { localStorage.setItem(SUMMARY_KEY, next ? '1' : '0') } catch { /* нет хранилища */ }
  }
  const canSummary = wide && !dayList && !weekMode && !monthMode && doctors.length > 0
  const summary = canSummary && !side && summaryOpen
  // Шапка перемеряется, когда меняется её содержимое (ширину окна, зум и размер текста ловит сам хук)
  useToolbarFit(toolbar, [date, all.length, doctors.length, partial, summary, canSummary, Boolean(side), weekMode, monthMode, bookable.length, Boolean(dayList), Boolean(medical)].join('|'))
  const nowOrNull = date === today ? nowMinutes : null
  const free = shown.map((d) => {
    const sl = slots[doctors.indexOf(d)]?.data
    const f = sl?.workingDay ? freeMinutes(sl.free ?? [], nowOrNull) : { minutes: 0, first: null }
    return { doctorId: d.id, name: d.fullName ?? '', color: colorOf(d), canBook: canEditDoctor(me, d.id), ...f }
  })
  const bookAt = (doctorId: number, minutes: number) => setSide({ kind: 'new', slot: { doctorId, date, minutes } })

  // Общие кресла (V185): значок «🪑 Кресло 1» в шапке колонки врача
  const chairs = useChairs(!dayList && !weekMode && !monthMode)
  const doctorName = (id: number) => doctors.find((d) => d.id === id)?.fullName ?? ''

  // Всплывающая карточка приёма при наведении мышью (компьютер) — общая для «Дня»
  const hover = useApptHover(me, (id) => doctors.find((d) => d.id === id)?.fullName ?? '')
  // Нажали на блок приёма — карточка справа; стабильная функция, чтобы DayAppt (memo) не перерисовывался
  const openAppt = useCallback((id: number) => setSide({ kind: 'appointment', id }), [])

  // Чьё расписание. Телефон: переключателя «День | Месяц» нет — месяц открывается нажатием на дату (лист снизу)
  const doctorSwitch = doctors.length > 1 && (narrow || doctors.length > MAX_CHIPS ? (
    // Телефон (и больше 6 врачей на компьютере — ряд чипов уже не помещается): одна кнопка со списком
    <DoctorPicker me={me} doctors={doctors} view={weekMode && weekDoctor != null ? weekDoctor : view} date={date} onChange={setView}
      colorDoctors={clinicDoctors} onOrder={() => setOrdering(true)} shownCount={shown.length} compact={!narrow} />
  ) : (
    // Компьютер: чипы с тем же цветным кружком, что у колонки врача, — видно, кто где
    <div className="doctor-chips" role="group" aria-label="Чьё расписание">
      {!weekMode && (
        <button type="button" className="doctor-chip" aria-pressed={view === 'all'} onClick={() => setView('all')}>
          <span className="avatar all" aria-hidden="true">👥</span>Все врачи
        </button>
      )}
      {doctors.map((d) => (
        <button key={d.id} type="button" className="doctor-chip" aria-pressed={(weekMode ? weekDoctor : view) === d.id} onClick={() => setView(d.id)}>
          <span className="avatar" style={{ background: colorOf(d) }} aria-hidden="true">{initials(d.fullName)}</span>
          {d.fullName}{d.id === me.doctorId ? ' (я)' : ''}
        </button>
      ))}
      <button type="button" className="doctor-chip order" title="Врачи в расписании: кого показывать и в каком порядке" aria-label="Врачи в расписании…" onClick={() => setOrdering(true)}>⇅</button>
    </div>
  ))

  if (medical) {
    return (
      <div className="schedule">
        <MedicalRecord patient={medical.patient} backLabel="← К приёму" readOnly={isAssistant(me)}
          onBack={() => { setSide({ kind: 'appointment', id: medical.from }); setMedical(null) }} />
      </div>
    )
  }

  return (
    <div className={side ? 'schedule with-panel' : summary ? 'schedule with-summary' : 'schedule'}>
      <section className="schedule-main">
        {/* Телефон: без заголовка дня — день выбирают в ленте (там же месяц и «📅 другой день») */}
        {!dayList && (
          <header ref={toolbar} className="toolbar schedule-toolbar">
            <div className="day-switch">
              <button type="button" className="btn ghost" aria-label={monthMode ? 'Предыдущий месяц' : weekMode ? 'Предыдущая неделя' : 'Предыдущий день'}
                onClick={() => (monthMode ? goMonth(addMonths(month, -1)) : setDate(addDays(date, weekMode ? -7 : -1)))}>‹</button>
              <button type="button" className="btn ghost" aria-label={monthMode ? 'Следующий месяц' : weekMode ? 'Следующая неделя' : 'Следующий день'}
                onClick={() => (monthMode ? goMonth(addMonths(month, 1)) : setDate(addDays(date, weekMode ? 7 : 1)))}>›</button>
              {/* Календарь — значком рядом со стрелками: дата и так крупно в заголовке */}
              <DateInput id="schedule-date" iconOnly aria-label="Выбрать дату" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
            {monthMode ? (
              <div className="day-title">
                <div className="with-hint"><h1><button type="button" className="day-title-pick" title="Выбрать дату"
                  onClick={() => document.getElementById('schedule-date')?.click()}>{monthTitle(month)} <span className="caret" aria-hidden="true">▾</span></button></h1><HelpHint hint="schedule" /></div>
                <span className="hint">
                  {today.startsWith(month) ? 'этот месяц · ' : ''}{view === 'all' || shown.length !== 1 ? 'все врачи' : shown[0]!.fullName}
                  {monthData.pending ? '' : ` · ${monthCount ? `записей ${monthCount}` : 'записей нет'}`}
                </span>
              </div>
            ) : weekMode ? (
              <div className="day-title">
                <div className="with-hint"><h1><button type="button" className="day-title-pick" title="Выбрать дату"
                  onClick={() => document.getElementById('schedule-date')?.click()}>Неделя {weekLabel(monday)} {monday.slice(0, 4)} <span className="caret" aria-hidden="true">▾</span></button></h1><HelpHint hint="schedule" /></div>
                <span className="hint">
                  {monday === weekStart(today) ? 'эта неделя · ' : ''}{doctors.find((d) => d.id === weekDoctor)?.fullName}
                  {week.data ? ` · записей ${week.data.filter((a) => a.status !== 'CANCELLED' && !fromYesterday(a, monday)).length}` : ''}
                </span>
              </div>
            ) : (
              <div className="day-title">
                {/* Дата кликабельна — открывает тот же календарь, что значок рядом со стрелками */}
                <div className="with-hint"><h1><button type="button" className="day-title-pick" title="Выбрать дату"
                  onClick={() => document.getElementById('schedule-date')?.click()}>{dayTitle(date)} <span className="caret" aria-hidden="true">▾</span></button></h1><HelpHint hint="schedule" /></div>
                <span className="hint">
                  {date === today ? 'сегодня · ' : ''}{all.length ? `Записей: ${all.length}` : 'Записей нет'}
                  {doctors.length > 1 ? ` · врачей ${doctors.length}` : ''}
                  {partial && <span className="shown-of"> · {partial}</span>}
                </span>
              </div>
            )}
            {monthMode
              ? !today.startsWith(month) && <button type="button" className="btn" onClick={() => setDate(today)}>Этот месяц</button>
              : weekMode
                ? monday !== weekStart(today) && <button type="button" className="btn" onClick={() => setDate(today)}>Эта неделя</button>
                : date !== today && <button type="button" className="btn" onClick={() => setDate(today)}>Сегодня</button>}
            <ViewModes mode={monthMode ? 'month' : weekMode ? 'week' : 'day'} week={desktop} onChange={setMode} />

            {/* Действия — одной неразрывной группой справа. Тесно (крупный текст, зум, узкое окно) — useToolbarFit
                оставляет у «Сводки дня» только значок; группа строки не делит. Пришёл без записи — «⚡ Сейчас» в «Новой записи» */}
            <div className="toolbar-actions push">
              {bookable.length > 0 && <button type="button" className="btn primary" data-tour="new-appointment" onClick={newHere}>＋ Новая запись</button>}
              {/* Открытую сводку закрывает «×» в ней самой — в шапке кнопка только чтобы вернуть */}
              {canSummary && !summary && (
                <button type="button" className="btn small toolbar-summary" onClick={toggleSummary} aria-label="Сводка дня"
                  title="Сводка дня: кто следующий, что требует внимания, свободное время">
                  <Icon name="summary" /><span className="toolbar-summary-label">Сводка дня</span>
                </button>
              )}
            </div>
          </header>
        )}

        <SetupChecklist me={me} />
        {dayList ? (
          <>
            {/* Телефон: только то, что нужно сделать сейчас, — заявки и оплата на кассе (и «мой день» врача). «Ждём ответа» видно в строках
                дня, «склад: мало» — в «Складе» и сообщением бота: на главной это было лишнее */}
            {(requests.length > 0 || (toPay.data?.length ?? 0) > 0 || earnings.data) && (
              <div className="today-strip compact" role="group" aria-label="Требует внимания">
                {requests.length > 0 && (
                  <button type="button" className="stat s-request" onClick={firstOf(requests)}>
                    <b>{requests.length}</b> {requests.length === 1 ? 'заявка' : 'заявки'}
                  </button>
                )}
                {(toPay.data?.length ?? 0) > 0 && (
                  <button type="button" className="stat s-cashier" onClick={() => onNavigate?.('cash')}><b>{toPay.data!.length}</b> к оплате</button>
                )}
                {earnings.data && <EarningsChip compact e={earnings.data} onOpen={openEarnings} />}
              </div>
            )}
            {doctorSwitch}
          </>
        ) : (
          // Компьютер: врачи, полоса «Сегодня» и «Отменено: N» — одной строкой над сеткой (врачи слева,
          // плашки справа): каждое отдельной строкой съедало полэкрана над расписанием
          <div className="schedule-bar">
            {doctorSwitch}
            {offHint}
            {!summary && !weekMode && !monthMode && (
              <div className="today-strip" role="group" aria-label="Требует внимания">
                {requests.length > 0 && (
                  <button type="button" className="stat s-request" onClick={firstOf(requests)}
                    aria-label={`${requests.length} ${requests.length === 1 ? 'заявка из бота' : 'заявки из бота'} — подтвердить`} title="Заявки из бота — подтвердить">
                    <b>{requests.length}</b> {requests.length === 1 ? 'заявка' : 'заявки'}
                  </button>
                )}
                {waiting.length > 0 && (
                  <button type="button" className="stat s-wait" onClick={firstOf(waiting)}
                    aria-label={`${waiting.length} ждём ответа на напоминание`} title="Ждём ответа на напоминание">
                    <b>{waiting.length}</b> ждут ответа
                  </button>
                )}
                {(toPay.data?.length ?? 0) > 0 && (
                  <button type="button" className="stat s-cashier" onClick={() => onNavigate?.('cash')}
                    aria-label={`${toPay.data!.length} ждут оплаты на кассе`} title="Ждут оплаты на кассе">
                    <b>{toPay.data!.length}</b> к оплате
                  </button>
                )}
                {revenue.data && (
                  <button type="button" className="stat s-quiet" onClick={() => onNavigate?.('cash')}>
                    <b>{somText(revenue.data.totalSom).replace(' сом', '')}</b> сом {date === today ? 'сегодня' : 'за день'}
                  </button>
                )}
                {earnings.data && <EarningsChip e={earnings.data} onOpen={openEarnings} />}
                {low > 0 && (
                  <button type="button" className="stat s-wait" onClick={() => onNavigate?.('stock')}
                    aria-label={`${low} на складе заканчивается`} title="На складе заканчивается">
                    <b>{low}</b> мало на складе
                  </button>
                )}
                {!requests.length && !waiting.length && !toPay.data?.length && !low && (
                  <span className="stat s-quiet calm" title="Всё под контролем: заявок и срочных дел нет" aria-label="Всё под контролем: заявок и срочных дел нет">✓ Всё спокойно</span>
                )}
              </div>
            )}
            {/* Отменённые в сетке не рисуем, но и не прячем молча: «Отменено: N ›» — ссылкой в конце строки над
                сеткой (под сеткой строка уходила за край экрана и её не замечали); раскрытый список — строкой ниже */}
            {!weekMode && !monthMode && shown.length > 0 && (
              <CancelledList inline items={loaded.filter((a) => a.status === 'CANCELLED' && (view === 'all' || shown.some((d) => d.id === a.doctorId)))}
                selectedId={selected?.id} onOpen={(a) => setSide({ kind: 'appointment', id: a.id, fallback: a })}
                doctorName={view === 'all' ? (id) => doctors.find((d) => d.id === id)?.fullName ?? '' : undefined} />
            )}
          </div>
        )}
        {ordering && (
          <DoctorOrderDialog doctors={doctors} hidden={hiddenDoctors} myDoctorId={me.doctorId} colorDoctors={clinicDoctors}
            onSave={(ids, hidden) => { setDoctorOrder(ids); setHiddenDoctors(hidden); setOrdering(false) }}
            onReset={() => { setDoctorOrder(null); setHiddenDoctors([]); setOrdering(false) }}
            onClose={() => setOrdering(false)} />
        )}

        {dayList ? (
          <DayList me={me} doctors={dayList.map((d) => ({ id: d.id, name: d.fullName ?? '', color: colorOf(d) }))} date={date} onDate={setDate} selectedId={selected?.id}
            all={view === 'all' && doctors.length > 1}
            doctorsNote={partial || offHidden.length ? <>{partial && <span className="shown-of">{partial.replace(/^./, (c) => c.toUpperCase())}</span>}{partial && offHidden.length ? ' · ' : ''}{offHint}</> : undefined}
            onNewHere={bookable.length > 0 ? newHere : undefined}
            onOpen={(a) => setSide({ kind: 'appointment', id: a.id, fallback: a })}
            onNew={(doctorId, minutes) => setSide({ kind: 'new', slot: { doctorId, date, minutes } })} />
        ) : monthMode ? (
          <MonthGrid month={month} today={today} selected={date} data={monthData} compact={narrow}
            onOpenDay={(day) => { setDate(day); setMode('day') }} />
        ) : weekMode && weekDoctor != null ? (
          <WeekGrid me={me} doctorId={weekDoctor} monday={monday} today={today} selectedId={selected?.id}
            onOpen={(a) => setSide({ kind: 'appointment', id: a.id, fallback: a })}
            onNew={(day, minutes) => setSide({ kind: 'new', slot: { doctorId: weekDoctor, date: day, minutes } })}
            onOpenDay={(day) => { setDate(day); setMode('day') }} />
        ) : doctors.length === 0 ? (
          <EmptyState title="В клинике пока нет врачей" action={<button type="button" className="btn primary" onClick={() => openClinic('staff')}>Добавить врача</button>}>
            Добавьте врачей в «Клиника → Персонал» — появится расписание.
          </EmptyState>
        ) : (
          <div className="grid-wrap">
            <div ref={grid} className="grid" style={{ gridTemplateColumns: `56px repeat(${shown.length}, minmax(140px, 1fr))`, '--cols': shown.length } as CSSProperties}>
              <div className="grid-corner" />
              {shown.map((d) => {
                // Свой цвет врача — полоса над колонкой и слева на карточках; часы работы и кресло — под именем
                const color = colorOf(d)
                const sl = slots[doctors.indexOf(d)]?.data
                const hoursText = slotsHoursText(sl)
                return (
                  <button key={d.id} type="button" className="grid-head" title={`Только ${d.fullName}`} disabled={shown.length === 1}
                    style={{ '--doc': color } as CSSProperties} onClick={() => setView(d.id)}>
                    {d.photoUrl
                      ? <img className="avatar photo" src={d.photoUrl} alt="" />
                      : <span className="avatar" style={{ background: color }} aria-hidden="true">{initials(d.fullName)}</span>}
                    {/* Две строки: имя; ниже мелко «специальность · часы · 🪑 кресло» одной строкой с многоточием */}
                    <span className="grid-head-text">
                      <span className="grid-head-name">{d.fullName}{d.id === me.doctorId ? ' (я)' : ''}</span>
                      <span className="grid-head-sub">
                        {specialtyOf(d.about) && <span className="grid-head-spec" title={d.about}>{specialtyOf(d.about)}</span>}
                        {hoursText && <span className="grid-head-hours num">{hoursText}</span>}
                        <ChairBadge chairs={chairs.data} doctorId={d.id} nameOf={doctorName} />
                      </span>
                    </span>
                  </button>
                )
              })}
              <div className="grid-times" style={{ height }}>
                {/* Час рядом с меткой «сейчас» прячем — иначе «11:00» и «11:10» наезжают друг на друга */}
                {hours.filter((m) => nowTop == null || Math.abs(m - nowMinutes) > 15).map((m) => (
                  <span key={m} className={`num${m === DAY ? ' grid-midnight-time' : ''}`} style={{ top: PAD + (m - from) * PX }}>
                    {hourLabel(m)}{m === DAY && <small>завтра</small>}
                  </span>
                ))}
                {nowTop != null && <span className="now-label num" style={{ top: nowTop }}>{timeOf(new Date().toISOString())}</span>}
              </div>
              {shown.map((d) => {
                const q = days[doctors.indexOf(d)]
                const sl = slots[doctors.indexOf(d)]?.data
                const y = (minutes: number) => PAD + (Math.min(Math.max(minutes, from), to) - from) * PX
                const off = sl?.workingDay ? offSpans(workSpans(sl, date), from, to) : []
                return (
                  <div key={d.id} className="grid-col" style={{ height }} role="group" aria-label={d.fullName}
                    title={canEditDoctor(me, d.id) ? 'Нажмите на свободное время — новая запись' : 'Расписание коллеги — только просмотр'} onClick={pick(d.id)}>
                    {hours.map((m) => <div key={m} className="grid-hour" style={{ top: PAD + (m - from) * PX }} />)}
                    {/* Сетка продлена после полуночи: черта «полночь» с датой следующего дня (подпись — справа в последней колонке: слева обычно приёмы) */}
                    {to > DAY && (
                      <div className="grid-midnight" style={{ top: PAD + (DAY - from) * PX }} aria-hidden="true">
                        {d === shown[shown.length - 1] && <span>полночь · {dayTitle(addDays(date, 1)).toLowerCase()}</span>}
                      </div>
                    )}
                    {nowTop != null && <div className="grid-past" style={{ height: nowTop }} />}
                    {sl && !sl.workingDay && (
                      <div className="grid-off" style={{ top: 0, height }}><span>{sl.dayOff ? `${sl.dayOff.emoji ?? ''} ${sl.dayOff.title ?? ''}` : 'Выходной'}</span></div>
                    )}
                    {/* Нерабочее до начала, после конца и между хвостом ночной смены и новой сменой */}
                    {off.map(([s, e]) => (
                      <div key={`off-${s}`} className="grid-off" style={{ top: s <= from ? 0 : y(s), height: (e >= to ? height : y(e)) - (s <= from ? 0 : y(s)) }} />
                    ))}
                    {(sl?.breaks ?? []).map((b) => (
                      <div key={b.start} className="grid-break" style={{ top: y(dayMinutes(b.start!, date)), height: Math.max(y(dayMinutes(b.end!, date)) - y(dayMinutes(b.start!, date)), 14) }}
                        title={`${timeOf(b.start!)}–${timeOf(b.end!)} ${b.title ?? ''}`}>
                        <span>{b.emoji} {b.title}</span>
                      </div>
                    ))}
                    {/* Кресло врача занято другим врачом (общее кресло, V185): не свободно, нажатие не создаёт запись */}
                    {sl?.workingDay && (sl.chairBusy ?? []).map((b) => {
                      const top = y(dayMinutes(b.start, date))
                      const text = `${timeOf(b.start)}–${timeOf(b.end)}: кресло занято (${b.doctorName})`
                      return (
                        <div key={`chair-${b.start}`} className="grid-break grid-chair" role="note" aria-label={text}
                          title={`${text} — «${b.chairName}» в это время у другого врача`}
                          style={{ top, height: Math.max(y(dayMinutes(b.end, date)) - top, 14) }}>
                          <span>🪑 кресло занято ({b.doctorName})</span>
                        </div>
                      )
                    })}
                    {sl?.workingDay && (sl.free ?? []).map((w) => {
                      // Свободное окно — светлый блок «Свободно 13:00–18:00 · ＋ записать»; сегодня — только то, что впереди
                      const start = Math.max(dayMinutes(w.start, date), nowOrNull ?? 0, from)
                      const end = Math.min(dayMinutes(w.end, date), to)
                      if (end - start < 15) return null
                      const text = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}–${timeOf(w.end)}`
                      const h = (end - start) * PX - 4
                      const style = { top: PAD + (start - from) * PX + 2, height: h }
                      if (!canEditDoctor(me, d.id)) return <div key={w.start} className="grid-free readonly" style={style}><span className="num">{text}</span> свободно</div>
                      return (
                        <button key={w.start} type="button" className={`grid-free${h < 52 ? ' short' : ''}`} style={style}
                          aria-label={`Свободно с ${text.replace('–', ' до ')}, записать`} onClick={() => bookAt(d.id, Math.ceil(start / 5) * 5)}>
                          <span className="grid-free-text">Свободно <span className="num">{text}</span></span>
                          <span className="grid-free-add">＋ записать</span>
                        </button>
                      )
                    })}
                    {/* Часы коллеги по креслу (V187) — поверх «Свободно»: записать можно, но с вопросом */}
                    <ChairTimeBands slots={sl} date={date} y={y} from={from} to={to}
                      appointments={(q?.data ?? []).filter((a) => a.status !== 'CANCELLED')} />
                    {nowTop != null && <div className="grid-now" style={{ top: nowTop }} />}
                    {q?.isPending && <Loading variant="inline" className="grid-loading" />}
                    {q?.error && <div className="error grid-loading">{q.error.message}</div>}
                    {(q?.data ?? []).filter((a) => a.status !== 'CANCELLED').map((a) => (
                      <DayAppt key={a.id} a={a} date={date} from={from} limit={limit} active={selected?.id === a.id} money={seesMoneyOf(me, a.doctorId)}
                        chairTime={sl?.chairTime} hover={hover.bind} onOpen={openAppt} />
                    ))}
                  </div>
                )
              })}
            </div>
            {hover.card}
            {/* Ни одного приёма в дне — Тишка «водяным знаком» поверх видимой части сетки (вне прокрутки); нажатия проходят к свободным окнам */}
            {shown.length > 0 && shown.every((d) => days[doctors.indexOf(d)]?.isSuccess)
              && shown.every((d) => !(days[doctors.indexOf(d)]?.data ?? []).some((a) => a.status !== 'CANCELLED')) && (
              <div className="grid-empty">
                <EmptyState title={emptyDayText(date, today)}>{date >= today ? 'Нажмите на свободное время, чтобы записать.' : null}</EmptyState>
              </div>
            )}
          </div>
        )}
        {!dayList && !monthMode && doctors.length > 0 && <BadgesLegend chair={Boolean(chairs.data?.some((c) => (c.doctorIds?.length ?? 0) > 1))} />}
      </section>
      {summary && (
        <DaySummary date={date} today={today} all={all} requests={requests} waiting={waiting} toPay={toPay.data?.length ?? 0}
          revenueSom={revenue.data ? revenue.data.totalSom : null} earnings={earnings.data ?? null} onOpenEarnings={openEarnings} low={low} free={shown.length > 0 && date >= today ? free : []}
          doctorName={(id) => doctors.find((d) => d.id === id)?.fullName ?? ''}
          onOpen={(a) => setSide({ kind: 'appointment', id: a.id, fallback: a })} onBook={bookAt} onNavigate={onNavigate} onClose={toggleSummary} />
      )}
      {/* key: другой приём — новая карточка, формы и «Вернуть» прежнего не переносятся */}
      {selected && <AppointmentPanel key={selected.id} appointment={selected} me={me} onClose={close} onOpenPatient={onOpenPatient}
        onMedical={(patient) => setMedical({ patient, from: selected.id })}
        onBook={(slot, patient) => setSide({ kind: 'new', slot, patient })} />}
      {side?.kind === 'new' && (
        <NewAppointmentPanel slot={side.slot} me={me} initialPatient={side.patient} nowDoctorId={firstBookable()?.id} onClose={close}
          onCreated={(a) => setSide({ kind: 'appointment', id: a.id, fallback: a })} />
      )}
    </div>
  )
}

/** «День | Неделя | Месяц»; «Неделя» — только на компьютере (семь колонок на телефоне не читаются). */
function ViewModes({ mode, week, onChange }: { mode: Mode; week: boolean; onChange: (mode: Mode) => void }) {
  return (
    <div className={`segments view-mode${week ? '' : ' compact'}`} role="group" aria-label="Вид расписания">
      <button type="button" aria-pressed={mode === 'day'} onClick={() => onChange('day')}>День</button>
      {week && <button type="button" aria-pressed={mode === 'week'} onClick={() => onChange('week')}>Неделя</button>}
      <button type="button" aria-pressed={mode === 'month'} onClick={() => onChange('month')}>Месяц</button>
    </div>
  )
}
