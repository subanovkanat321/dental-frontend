import { markText, statusTone } from '../lib/whatsapp'
import { ApptBadges } from './ApptBadges'
import { CancelledList } from './CancelledList'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useReminderNotSent } from './useReminderNotSent'
import { confirmRemind, remindedText } from './remindAgain'
import { addDays, emptyDayText, minutesOf, shortDay, somText, timeOf, todayIn } from '../lib/time'
import { serviceEmoji } from '../lib/serviceEmoji'
import { MonthSheet } from './month/MonthSheet'
import { isShaky } from './paint'
import { statusOf } from './status'
import { useAppointmentAction } from './useAppointmentAction'
import { colleagueMarkText, colleagueTimeOf, listedChairTime } from './chairTime'
import { askPlanDone, canMarkPlan, useAskPlanDone, usePlanLeft } from './planDoneStore'
import { useRowSwipe } from './useRowSwipe'
import { TagDots } from '../tags/TagDots'
import { NOWHERE_TEXT, useRemind } from './useRemind'
import { useMedia } from '../lib/useMedia'
import { plural } from '../lib/plural'
import type { FreeWindow } from './windowsModel'
import { canEditDoctor as canEdit, seesMoneyOf, seesAllMoney as seesAllMoneyOf } from '../lib/roles'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { serviceLabel } from './lineLabel'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type ChairTime = Schemas['SlotsViewChairTime']

/** Короткая подсказка под строкой после напоминания: «WhatsApp открыт», «некуда — откройте карточку» */
type Notice = { text: string; tone: 'ok' | 'warn'; card?: boolean }

type Item =
  | { kind: 'appointment'; at: string; a: Appointment; chair?: ChairTime }
  | { kind: 'free'; at: string; end: string; doctorId: number }
  | { kind: 'pause'; at: string; end: string; title: string; emoji: string; doctorId: number }
  | { kind: 'colleague'; at: string; end: string; name: string; doctorId: number }

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long' })
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' })
const at0 = (d: string) => new Date(`${d}T00:00:00Z`)

/** «Сегодня» / «Завтра» / «Вчера» или день недели; ниже — «понедельник, 2 ноября». */
function dayTitle(date: string, today: string): { main: string; sub: string } {
  const near = date === today ? 'Сегодня' : date === addDays(today, 1) ? 'Завтра' : date === addDays(today, -1) ? 'Вчера' : null
  const weekday = WEEKDAY.format(at0(date))
  const dayMonth = DAY_MONTH.format(at0(date))
  return near ? { main: near, sub: `${weekday}, ${dayMonth}` } : { main: weekday.replace(/^./, (x) => x.toUpperCase()), sub: dayMonth }
}

/** color — цвет врача (lib/avatars colorOf): кружок в шапке колонки и полоска слева у его записей */
type Doctor = { id: number; name: string; color?: string }

/** «Нурболот Асанов» → «Нурболот»: в строке списка мало места. */
function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/**
 * «День» списком — как в прежнем приложении на телефоне: один день крупно (листать стрелками, любой — календарём),
 * «＋ Новая запись», строки по времени — приёмы, «свободно до …» (нажать — записать) и перерывы.
 * Один врач — его день; «Все врачи» — все приёмы вместе, у строки имя врача, свободные окна
 * каждого врача отдельно. У приёма — быстрое напоминание (Telegram или WhatsApp). Завтра — «Готово X из Y».
 */
export function DayList({ me, doctors, date, onDate, onOpen, onQuick, onNew, onNewHere, selectedId, all, doctorsNote, paintOf, onCalendar, inToolbar, windows = [], onWindows, emptyActions }: {
  me: Me
  doctors: Doctor[]
  date: string
  onDate: (date: string) => void
  onOpen: (a: Appointment) => void
  /** Долгое нажатие (или правая кнопка) на строку приёма — меню быстрых действий нижним листом */
  onQuick?: (a: Appointment, at: null) => void
  onNew: (doctorId: number, minutes: number) => void
  /** «＋ Новая запись» на этот день (врач и время — в форме). */
  onNewHere?: () => void
  selectedId?: number
  /** «Все врачи», даже если колонка одна (остальные скрыты или выходной): шапка врача у колонки остаётся */
  all?: boolean
  /** «Показано 4 из 10 · Выходной: Айгерим · показать» (SchedulePage) */
  doctorsNote?: ReactNode
  /** «Чем красить запись» (schedule/paint.ts): цвет заливки строки по врачу или услуге; по статусу — undefined */
  paintOf?: (a: Appointment) => string | undefined
  /** «Все врачи»: нажали на имя в шапке колонки — мини-календарь врача */
  onCalendar?: (doctorId: number) => void
  /** «Список» на компьютере: день, стрелки и «Сегодня» — в шапке расписания, своей строки даты нет */
  inToolbar?: boolean
  /**
   * «🔔 Окна» листа ожидания: у свободного времени — «🔔 2 из листа» (нажать — предложить). Владелец 2026-11-25:
   * отдельная плашка «5 окон» сверху непонятна — пометка теперь там, где само окно
   */
  windows?: FreeWindow[]
  onWindows?: () => void
  /** «Список» на компьютере: в пустом дне — «＋ Новая запись» и «Открыть завтра» (владелец 2026-11-27) */
  emptyActions?: ReactNode
}) {
  const today = todayIn()
  const many = all ?? doctors.length > 1
  // Свайпы по строке — телефон (палец, pointer: coarse); у «Все врачи» колонки сами листаются вбок — без свайпов
  const touch = useMedia(SWIPE_MEDIA)
  const swipe = touch && !many
  const canEditDoctor = (id: number) => canEdit(me, id)
  const appointments = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['appointments', date, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments', { params: { query: { date, doctorId: d.id } } })),
      refetchInterval: 60_000,
    })),
  })
  const slots = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['slots', date, d.id],
      queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId: d.id } } })),
      // Окна меняются вместе с приёмами (запись из бота, коллега с компьютера) — обновлять так же
      refetchInterval: 60_000,
    })),
  })
  const single = many ? null : doctors[0]
  const seesAllMoney = seesAllMoneyOf(me)
  const seesMoney = single ? seesAllMoney || single.id === me.doctorId : seesAllMoney
  const loaded = appointments.flatMap((q) => q.data ?? [])
  const list = loaded.filter((a) => a.status !== 'CANCELLED')
  // Отменённые не занимают строки дня, но и не пропадают молча — «Отменено: N ›» внизу дня врача
  const cancelled = loaded.filter((a) => a.status === 'CANCELLED')
  const revenue = useQuery({
    queryKey: ['revenue', date, date, single?.id ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: date, to: date, ...(single ? { doctorId: single.id } : {}) } } })),
    enabled: seesMoney && date <= today && list.some((a) => a.status === 'DONE'),
  })

  const nameOf = new Map(doctors.map((d) => [d.id, shortName(d.name)]))
  // Строки одного врача по времени: приёмы, свободные окна, перерывы
  const itemsOf = (d: Doctor, i: number): Item[] => [
    ...list.filter((a) => a.doctorId === d.id).map((a) => ({ kind: 'appointment' as const, at: a.startAt, a, chair: colleagueTimeOf(a, slots[i]?.data?.chairTime) })),
    ...(slots[i]?.data?.free ?? []).map((w) => ({ kind: 'free' as const, at: w.start, end: w.end, doctorId: d.id })),
    ...(slots[i]?.data?.breaks ?? []).map((b) => ({ kind: 'pause' as const, at: b.start!, end: b.end!, title: b.title ?? '', emoji: b.emoji ?? '', doctorId: d.id })),
    // Часы коллеги по креслу (V187): записать можно, сервер спросит «Коллега предупреждён?». В часах врача — всегда,
    // вне их и в выходной — только если там его приём (listedChairTime): без шума от пустого вечера коллеги
    ...listedChairTime(slots[i]?.data, date, list.filter((a) => a.doctorId === d.id))
      .map((t) => ({ kind: 'colleague' as const, at: t.start, end: t.end, name: t.doctorName ?? '', doctorId: d.id })),
  ].sort((x, y) => x.at.localeCompare(y.at))
  const groups = doctors.map((d, i) => ({ doctor: d, items: itemsOf(d, i), booked: list.filter((a) => a.doctorId === d.id).length }))
  const items = groups.flatMap((g) => g.items)
  const scheduled = list.filter((a) => a.status === 'SCHEDULED')
  const ready = scheduled.filter((a) => a.reminderOpenedAt || a.soonRemindedAt || (a.reply && a.reply !== 'NONE')).length
  const now = new Date().toISOString()
  const next = date === today ? [...list].sort((x, y) => x.startAt.localeCompare(y.startAt)).find((a) => a.status === 'SCHEDULED' && a.startAt > now) : undefined
  const off = doctors.filter((_, i) => slots[i]?.data && !slots[i].data.workingDay)
  const offText = single ? (off.length ? (slots[0]!.data!.dayOff ? `${slots[0]!.data!.dayOff.emoji ?? ''} ${slots[0]!.data!.dayOff.title ?? ''}` : 'Выходной') : null)
    : off.length ? `Не работают: ${off.map((d) => nameOf.get(d.id)).join(', ')}` : null
  const note = [
    offText,
    // Скольким на завтра уже напомнили (или пациент сам ответил). Было «Готово 1 из 2» — владелец 2026-11-25: «что это?»
    date === addDays(today, 1) && scheduled.length ? `Напомнили: ${ready} из ${scheduled.length}` : null,
    revenue.data?.totalSom ? `За день: ${somText(revenue.data.totalSom)}` : null,
  ].filter(Boolean).join(' · ')
  const title = dayTitle(date, today)
  const pending = appointments.some((q) => q.isPending) || slots.some((q) => q.isPending)
  const failed = appointments.find((q) => q.error)?.error
  const [monthOpen, setMonthOpen] = useState(false)
  // Поменяли порядок врачей — колонки снова с начала: браузер держит прокрутку за прежней колонкой,
  // и первый врач оказывался за левым краем
  const columns = useRef<HTMLDivElement>(null)
  const order = doctors.map((d) => d.id).join(',')
  useEffect(() => {
    if (columns.current) columns.current.scrollLeft = 0
  }, [order])

  return (
    <div className={inToolbar ? 'day-list wide' : 'day-list'}>
      {!inToolbar && <>
      {/* Один день крупно: стрелки — на день назад и вперёд, нажать на дату — календарь, «Сегодня» — назад */}
      <div className="date-bar" role="group" aria-label="День">
        <button type="button" className="date-step" aria-label="Предыдущий день" onClick={() => onDate(addDays(date, -1))}>‹</button>
        {/* Нажать на дату — месяц листом снизу (число записей по дням), как вид «Месяц» */}
        <button type="button" className="date-pick" aria-label={`${title.main}, ${title.sub}: выбрать день`} aria-haspopup="dialog"
          onClick={() => setMonthOpen(true)}>
          <span className="date-main">{title.main} <span className="date-caret" aria-hidden="true">▾</span></span>
          <span className="date-sub"><span className="date-sub-full">{title.sub}</span><span className="date-sub-short" aria-hidden="true">{shortDay(date)}</span></span>
        </button>
        <button type="button" className="date-step" aria-label="Следующий день" onClick={() => onDate(addDays(date, 1))}>›</button>
        {date !== today && <button type="button" className="btn small date-today" onClick={() => onDate(today)}>Сегодня</button>}
        {/* «＋ Новая запись» — круглой кнопкой в строке даты (владелец 2026-11-25: «верхние штучки занимают много места»;
            была отдельной полосой во всю ширину). Пришёл без записи — та же «Новая запись», в ней «⚡ Сейчас» */}
        {onNewHere && <button type="button" className="btn primary date-new" data-tour="new-appointment" aria-label="＋ Новая запись"
          title="Новая запись" onClick={onNewHere}>＋</button>}
      </div>
      </>}
      {monthOpen && <MonthSheet date={date} today={today} doctorIds={doctors.map((d) => d.id)} onPick={onDate} onClose={() => setMonthOpen(false)} />}
      {single && !canEditDoctor(single.id) && <p className="readonly-note">Расписание коллеги — только просмотр</p>}
      {/* Одной строкой: «Не работают: … · Показано 6 из 10 · Выходной: … показать» */}
      {(note || doctorsNote) && <p className="hint day-note">{note}{note && doctorsNote ? ' · ' : ''}{doctorsNote}</p>}
      {pending ? <Loading />
        : failed ? <p className="error">{failed.message}</p>
          : items.length === 0 ? (
            <>
              <EmptyState title={emptyDayText(date, today)} action={emptyActions}>{offText}</EmptyState>
              <CancelledList items={cancelled} others={loaded} onOpen={onOpen} selectedId={selectedId} doctorName={many ? (id) => nameOf.get(id) ?? '' : undefined} />
            </>
          ) : (() => {
            const blocks = groups.map((g) => {
              const rows = (
                <>
                  {swipe && g.items.some((i) => i.kind === 'appointment') && <SwipeHint />}
                  <ul className="rows">
                    {g.items.map((item) => item.kind === 'appointment'
                      ? <Row key={`a${item.a.id}`} a={item.a} me={me} color={g.doctor.color} paint={paintOf?.(item.a)} chair={item.chair} next={item.a === next} active={item.a.id === selectedId}
                          canEdit={canEditDoctor(item.a.doctorId)} money={seesMoneyOf(me, item.a.doctorId)} onOpen={onOpen} onQuick={onQuick} swipe={swipe} />
                      : item.kind === 'colleague' ? (
                        <li key={`c${item.at}`} className="row pause colleague" role="note" aria-label={`${timeOf(item.at)}–${timeOf(item.end)}: время ${item.name}`}>
                          <span className="time num">{timeOf(item.at)}</span>
                          <span className="name"><span aria-hidden="true">🪑 </span>время {item.name}</span>
                          <span className="end num hint">{timeOf(item.end)}</span>
                        </li>
                      ) : item.kind === 'pause' ? (
                        <li key={`p${item.at}`} className="row pause">
                          <span className="time num">{timeOf(item.at)}</span>
                          <span className="name"><span aria-hidden="true">{item.emoji} </span>{item.title}</span>
                          <span className="end num hint">{timeOf(item.end)}</span>
                        </li>
                      ) : (
                        <FreeRow key={`f${item.at}`} start={item.at} end={item.end} canEdit={canEditDoctor(item.doctorId)}
                          doctor={many ? g.doctor.name : undefined} short={many && !inToolbar}
                          onPick={() => onNew(item.doctorId, minutesOf(item.at))} />
                      ))}
                    {g.items.length === 0 && <li className="hint day-empty">Нет записей</li>}
                  </ul>
                  <CancelledList items={cancelled.filter((a) => a.doctorId === g.doctor.id)} others={loaded} onOpen={onOpen} selectedId={selectedId} />
                </>
              )
              // «Все врачи» — у каждого врача свой блок; имя прилипает сверху при прокрутке
              return many ? (
                <section key={g.doctor.id} className="doctor-day" aria-label={g.doctor.name}>
                  <h3 className="doctor-day-head" title={g.doctor.name}>
                    <span className="avatar" style={g.doctor.color ? { background: g.doctor.color, color: '#fff' } : undefined} aria-hidden="true">{g.doctor.name.slice(0, 1)}</span>
                    {onCalendar ? (
                      <button type="button" className="doctor-day-name link" aria-haspopup="dialog" aria-label={`Календарь врача: ${g.doctor.name}`}
                        onClick={() => onCalendar(g.doctor.id)}>{shortName(g.doctor.name)}{g.doctor.id === me.doctorId ? ' (я)' : ''}</button>
                    ) : <span className="doctor-day-name">{shortName(g.doctor.name)}{g.doctor.id === me.doctorId ? ' (я)' : ''}</span>}
                    <span className="doctor-day-count" aria-label={`записей: ${g.booked}`}>{g.booked}</span>
                  </h3>
                  {rows}
                </section>
              ) : <div key={g.doctor.id}>{rows}</div>
            })
            // Приёмов нет, но есть свободные окна: врачи и окна — сверху (сразу видно, куда записать),
            // Тишка «На сегодня записей нет» — под ними
            const empty = list.length === 0 && (
              <EmptyState title={emptyDayText(date, today)} action={emptyActions}>{offText ?? (date >= today ? 'Нажмите на свободное окно выше, чтобы записать.' : null)}</EmptyState>
            )
            // «Все врачи» — списки врачей рядом, колонками; две — по половине экрана, больше двух — третья
            // выглядывает краем (peek: видно, что можно листать) и колонки листаются вбок
            return <>{many ? (
              // key={order}: сменили порядок — колонки строятся заново, а не переставляются внутри прокрутки. iPhone
              // (WebKit) при перестановке в прокручиваемом блоке со scroll-snap оставлял «призрак» прежней колонки
              // поверх соседней, пока экран не перерисуется
              <div key={order} ref={columns} className={groups.length > 2 ? 'doctor-columns peek' : 'doctor-columns'} style={{ '--cols': groups.length } as CSSProperties}>{blocks}</div>
            ) : blocks}{empty}<WaitingLine windows={windows} onWindows={onWindows} /></>
          })()}
    </div>
  )
}

/**
 * Лист ожидания — одной тонкой строкой под днём (владелец, 2026-11-26: «🔔 1 из листа» у каждого свободного окна
 * занимало слишком много места): сколько пациентов из листа подходят в свободное время этого дня. Нажать — окна с
 * «Предложить»; то же — в «Пациенты → Лист ожидания». Никого — строки нет.
 */
function WaitingLine({ windows, onWindows }: { windows: FreeWindow[]; onWindows?: () => void }) {
  if (!onWindows) return null
  const n = new Set(windows.flatMap((w) => w.matches.filter((m) => !m.declined).map((m) => m.entryId))).size
  if (n === 0) return null
  return (
    <button type="button" className="waiting-line" onClick={onWindows}>
      <span aria-hidden="true">🔔</span> Лист ожидания: {n} {plural(n, 'пациент подходит', 'пациента подходят', 'пациентов подходят')} в свободное время
      <span className="waiting-line-go" aria-hidden="true">›</span>
    </button>
  )
}

function FreeRow({ start, end, canEdit, doctor, short = false, onPick }: {
  start: string
  end: string
  canEdit: boolean
  /** «Все врачи»: чьё окно (для чтения с экрана) */
  doctor?: string
  /** Узкая колонка (телефон, «Все врачи»): коротко «до 13:00» */
  short?: boolean
  onPick: () => void
}) {
  const text = <>{short ? 'до' : 'свободно до'} {timeOf(end)}</>
  if (!canEdit) return <li className="row free readonly"><span className="time num">{timeOf(start)}</span><span className="hint">{text}</span></li>
  return (
    <li className="row free">
      <button type="button" className="row-button" aria-label={`Свободно с ${timeOf(start)} до ${timeOf(end)}${doctor ? ` у врача ${doctor}` : ''}, записать`} onClick={onPick}>
        <span className="time num">{timeOf(start)}</span><span className="hint">{text}</span><span className="plus" aria-hidden="true">＋</span>
      </button>
    </li>
  )
}

/**
 * Строка приёма: время, пациент, статус; быстрая кнопка напомнить (бот — в Telegram, иначе WhatsApp).
 * Напоминание уже ушло (или только что отправили) — вместо кнопки «✓ отправлено»: повторно — из карточки.
 * Ошибка — под строкой. WhatsApp — только когда загружены настройки (подпись клиники и ссылка на бота).
 * Телефон (swipe): свайп вправо — то же напоминание, влево — «Приём состоялся» с «Вернуть» (useRowSwipe).
 */
function Row({ a, me, color, paint, chair, next, active, canEdit, money, onOpen, onQuick, swipe = false }: {
  a: Appointment
  /** «Красить по врачу / услуге» — цвет заливки строки; статус остаётся словом */
  paint?: string
  me: Me
  /** Цвет врача — полоска слева; статус остаётся заливкой строки и словом (DESIGN.md) */
  color?: string
  /** Часы коллеги по креслу, в которые попал приём (colleagueTimeOf), — бейдж «🪑 время Айгерим» */
  chair?: ChairTime
  /** Видит ли деньги этого приёма (seesMoneyOf): иначе сервер прислал их пустыми — строки «предоплата» нет */
  money: boolean
  next: boolean
  active: boolean
  canEdit: boolean
  onOpen: (a: Appointment) => void
  onQuick?: (a: Appointment, at: null) => void
  /** Телефон: свайп вправо — напомнить, влево — «Приём состоялся» */
  swipe?: boolean
}) {
  const r = useRemind(a)
  const { action, opened, viaBot } = r
  // Статус — отдельной мутацией: успех «состоялся» не должен выглядеть как «напоминание отправлено»
  const status = useAppointmentAction(a)
  const [undo, setUndo] = useState<Appointment | null>(null)
  const li = useRef<HTMLLIElement>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const s = statusOf(a)
  const canRemind = canEdit && a.status === 'SCHEDULED' && a.endAt != null && new Date(a.endAt) > new Date()
  const notSent = useReminderNotSent(a)
  // После «не ушло» — снова кнопка, даже если успех нажатия ещё в памяти
  const sent = !notSent.undo.isSuccess && (Boolean(a.reminderOpenedAt || a.soonRemindedAt) || action.isSuccess || opened.isSuccess)
  // WhatsApp — только когда загружены настройки (текст напоминания)
  const busy = r.pending || (!viaBot && Boolean(r.phone) && r.text == null)
  // Тот же путь, что у карточки (useRemind): бот → «отправлено»; нет бота — WhatsApp; некуда — подсказка с карточкой
  const remind = () => {
    if (busy || sent) return
    notSent.undo.reset()
    setNotice(null)
    if (viaBot) {
      r.telegram(() => setNotice({ text: 'Напоминание отправлено в Telegram', tone: 'ok' }))
      return
    }
    if (r.nowhere) {
      setNotice({ text: NOWHERE_TEXT, tone: 'warn', card: true })
      return
    }
    if (r.whatsapp()) setNotice({ text: r.whatsappNotice, tone: 'ok' })
  }
  // Бот не доставил (409 not-delivered) — WhatsApp тем же текстом, если есть номер
  const fallbackWhatsapp = () => {
    if (r.whatsapp()) setNotice({ text: r.whatsappNotice, tone: 'ok' })
  }
  // Нажатие на «✓ отправлено»: тем же путём, с вопросом «Уже напоминали в 10:15. Отправить ещё раз?» и текстом
  // повтора (бот выбирает его сам по отметке; WhatsApp — useRepeatReminderText). Отметку «не ушло» снимать не нужно
  const canAgain = canRemind && sent && (viaBot || Boolean(r.phone))
  const remindAgain = async () => {
    if (r.pending || (!viaBot && r.text == null)) return
    if (!(await confirmRemind(a))) return
    notSent.undo.reset()
    setNotice(null)
    if (viaBot) {
      r.telegram(() => setNotice({ text: 'Напоминание отправлено в Telegram', tone: 'ok' }))
      return
    }
    if (r.whatsapp()) setNotice({ text: r.whatsappNotice, tone: 'ok' })
  }
  // Свайп вправо — то же, что быстрая кнопка; есть, пока она есть (не отправлено). Некуда — свайп покажет подсказку
  const canSwipeRemind = canRemind && !sent && !busy
  // Свайп влево — «Приём состоялся»: свой/доступный приём, запланирован и уже начался
  const canSwipeDone = canEdit && a.status === 'SCHEDULED' && new Date(a.startAt) <= new Date() && !status.isPending
  const done = () => status.mutate({ kind: 'status', body: { version: a.version, status: 'DONE' } }, {
    onSuccess: (updated) => { setUndo(updated); askPlanDone(updated.id) },
  })
  // После свайпа «состоялся» жест не прерываем окном: под строкой — «Этапы плана ›», если в плане есть несделанное;
  // он открывает карточку приёма с блоком «Что сделали сегодня?»
  const planAllowed = undo != null && canMarkPlan(me, undo)
  const planAsked = useAskPlanDone(a.id)
  const planLeft = usePlanLeft(a, planAllowed && planAsked)
  const back = () => undo && status.mutate({ kind: 'undo', body: { version: undo.version, previousStatus: 'SCHEDULED' } },
    { onSuccess: () => setUndo(null) })
  // Свайпы — как были; долгое нажатие (и правая кнопка) — меню быстрых действий, в том числе у «Все врачи», где свайпов нет
  useRowSwipe(li, swipe || Boolean(onQuick), {
    right: swipe && canSwipeRemind ? () => { hideSwipeHint(); remind() } : undefined,
    left: swipe && canSwipeDone ? () => { hideSwipeHint(); done() } : undefined,
    long: onQuick ? () => onQuick(a, null) : undefined,
  })
  // «Вернуть» — недолго, как тост
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 10_000)
    return () => clearTimeout(t)
  }, [undo])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.tone === 'ok' ? 4_000 : 10_000)
    return () => clearTimeout(t)
  }, [notice])
  // «Не доставлено» — отдельной подсказкой с WhatsApp ниже, не красной ошибкой
  const error = (r.notDelivered ? null : action.error) ?? opened.error ?? notSent.undo.error
  const statusError = status.error
  return (
    <li ref={li} className={['row', `s-${s.kind}`, next ? 'next' : '', active ? 'active' : '', a.status === 'NO_SHOW' ? 'struck' : '', swipe ? 'swipe' : '', color ? 'doc' : '',
      isShaky(a) ? 'shaky' : '', paint ? 'painted' : ''].filter(Boolean).join(' ')}
      style={color || paint ? { ...(color ? { '--doc': color } : {}), ...(paint ? { '--paint': paint } : {}) } as CSSProperties : undefined}>
      {swipe && canSwipeRemind && <span className="swipe-under swipe-right" aria-hidden="true">📲 {viaBot ? 'Telegram' : r.nowhere ? 'Напомнить' : 'WhatsApp'}</span>}
      {swipe && canSwipeDone && <span className="swipe-under swipe-left" aria-hidden="true">Состоялся ✔️</span>}
      <div className="row-slide">
        <button type="button" className="row-button" onClick={() => onOpen(a)}
          aria-label={`${timeOf(a.startAt)}–${timeOf(a.endAt)}, ${a.patient.fullName}: ${s.label}${chair ? `. ${colleagueMarkText(chair)}` : ''}`}>
          <span className="time num">{timeOf(a.startAt)}</span>
          {/* Имя обрезается многоточием, значки — нет: ❗ у длинного имени не должен пропасть */}
          <span className="name"><TagDots patient={a.patient} /><span className="name-text">{a.patient.fullName}</span> <ApptBadges appointment={a} money={money} /></span>
          <span className="end num hint">{timeOf(a.endAt)}</span>
          {/* Вторая строка: статус и заметки. Телефон — столбиком; «Список» на компьютере — одной строкой с многоточием,
              чтобы все записи были одной высоты (полностью — в карточке приёма) */}
          <span className="row-sub">
            <span className={`state tone-${s.tone}`}><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}{a.serviceName ? <span className="hint"> · {serviceEmoji(a.serviceName)} {serviceLabel(a)}</span> : null}</span>
            {chair && (
              <span className="row-note chair-mark" title={colleagueMarkText(chair)}>
                <span aria-hidden="true">🪑 </span>время {shortName(chair.doctorName ?? 'коллеги')}
              </span>
            )}
            {a.comment && <span className="row-note" title={a.comment}>{a.comment}</span>}
            {a.depositStatus && money && ['REQUESTED', 'SCHEDULED'].includes(a.status) && (
              <span className={`row-note tone-${a.depositStatus === 'RECEIVED' ? 'ok' : 'wait'}`}>
                Предоплата {somText(a.depositSom ?? 0)} · {a.depositStatus === 'RECEIVED' ? 'получена' : a.depositStatus === 'REPORTED' ? 'пациент оплатил — проверьте' : 'ждём'}
              </span>
            )}
            {/* Tish писал о приёме в WhatsApp (V256) — что с сообщением: доставлено, прочитано, не доставлено */}
            {a.whatsapp && ['REQUESTED', 'SCHEDULED'].includes(a.status) && (
              <span className={`row-note wa-mark tone-${statusTone(a.whatsapp.status)}`}><span title={markText(a.whatsapp) ?? undefined}>{markText(a.whatsapp, true)}</span></span>
            )}
          </span>
        </button>
        {canRemind && (sent ? (
          <span className="remind-sent-box">
            {/* Нажали «✓ отправлено» — «Отправить ещё?» (2026-11-21: «Не ушло? Снять отметку» путало). Отправить некуда
                (нет бота и номера) — тогда только снять отметку */}
            <button type="button" className="remind-sent tone-ok" disabled={notSent.undo.isPending || action.isPending || opened.isPending}
              onClick={canAgain ? () => void remindAgain() : notSent.run}
              aria-label={canAgain ? `Напоминание отправлено: ${a.patient.fullName}. Отправить ещё` : `Напоминание отправлено: ${a.patient.fullName}. Не ушло? Снять отметку`}
              title={a.reminderOpenedAt ?? a.soonRemindedAt ? `Напоминали ${remindedText((a.reminderOpenedAt ?? a.soonRemindedAt)!)}` : undefined}>✓ отправлено</button>
          </span>
        ) : (
          <span className="remind-pair">
            <button type="button" className={viaBot ? 'remind-quick tg' : 'remind-quick'} disabled={busy}
              aria-label={`${viaBot ? 'Напомнить в Telegram' : 'Напомнить в WhatsApp'}: ${a.patient.fullName}, ${timeOf(a.startAt)}`}
              onClick={remind}>{viaBot ? 'TG' : 'WA'}</button>
            {/* Пациент в Telegram, но есть и номер — WhatsApp рядом (2026-11-21, владелец: «не видно напомнить в WhatsApp») */}
            {viaBot && r.phone && (
              <button type="button" className="remind-quick" disabled={r.pending || r.text == null}
                aria-label={`Напомнить в WhatsApp: ${a.patient.fullName}, ${timeOf(a.startAt)}`}
                onClick={() => { notSent.undo.reset(); setNotice(null); if (r.whatsapp()) setNotice({ text: r.whatsappNotice, tone: 'ok' }) }}>WA</button>
            )}
          </span>
        ))}
      </div>
      {canRemind && error && <p className="error row-error" role="alert">{error.message}</p>}
      {canRemind && r.notDelivered && (
        <div className="undo row-undo warn" role="alert">
          <span>{action.error?.message}</span>
          {r.phone
            ? <button type="button" className="btn small" disabled={r.pending || r.text == null} onClick={fallbackWhatsapp}>Напомнить в WhatsApp</button>
            : <button type="button" className="btn small" onClick={() => onOpen(a)}>Открыть карточку</button>}
        </div>
      )}
      {notice && (
        <div className={`undo row-undo${notice.tone === 'warn' ? ' warn' : ''}`} role="status">
          <span>{notice.text}</span>
          {notice.card && <button type="button" className="btn small" onClick={() => { setNotice(null); onOpen(a) }}>Открыть карточку</button>}
        </div>
      )}
      {statusError && <p className="error row-error" role="alert">{statusError.message}</p>}
      {undo && (
        <div className="undo row-undo" role="status">
          <span>Отмечено: приём состоялся</span>
          {planAllowed && planAsked && planLeft.length > 0 && (
            <button type="button" className="link" onClick={() => onOpen(undo)}>Этапы плана ›</button>
          )}
          <button type="button" className="btn small" disabled={status.isPending} onClick={back}>Вернуть</button>
        </div>
      )}
    </li>
  )
}

/** Свайпы — только палец (тач-экран); мышь, даже в узком окне, — кнопки */
const SWIPE_MEDIA = '(pointer: coarse)'
/** Подсказку про свайпы показали и закрыли (или уже свайпнули) — флаг без данных пациентов */
const SWIPE_HINT_KEY = 'crm.schedule.swipeHint'
const hintListeners = new Set<() => void>()

function hintSeen(): boolean {
  try {
    return localStorage.getItem(SWIPE_HINT_KEY) === 'seen'
  } catch {
    return true // приватный режим — не надоедать
  }
}

function hideSwipeHint() {
  try {
    localStorage.setItem(SWIPE_HINT_KEY, 'seen')
  } catch {
    // приватный режим
  }
  hintListeners.forEach((f) => f())
}

/** Один раз на телефоне: как работают свайпы. Закрыть — ✕ или первый свайп. */
function SwipeHint() {
  const [seen, setSeen] = useState(hintSeen)
  useEffect(() => {
    const f = () => setSeen(true)
    hintListeners.add(f)
    return () => { hintListeners.delete(f) }
  }, [])
  if (seen) return null
  return (
    <p className="hint swipe-hint" role="note">
      <span>Смахните запись: → напомнить, ← состоялся; подержите — меню</span>
      <button type="button" className="btn ghost small" aria-label="Закрыть подсказку" onClick={hideSwipeHint}>✕</button>
    </p>
  )
}
