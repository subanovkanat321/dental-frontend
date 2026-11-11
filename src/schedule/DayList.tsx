import { ApptBadges } from './ApptBadges'
import { contactPhone } from '../lib/guardian'
import { CancelledList } from './CancelledList'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useReminderNotSent } from './useReminderNotSent'
import { useReminderText } from '../api/settings'
import { whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { addDays, emptyDayText, minutesOf, somText, timeOf, todayIn } from '../lib/time'
import { serviceEmoji } from '../lib/serviceEmoji'
import { MonthSheet } from './month/MonthSheet'
import { statusOf } from './status'
import { useAppointmentAction } from './useAppointmentAction'
import { colleagueMarkText, colleagueTimeOf, listedChairTime } from './chairTime'
import { useRowSwipe } from './useRowSwipe'
import { useMedia } from '../lib/useMedia'
import { canEditDoctor as canEdit, seesMoneyOf, seesAllMoney as seesAllMoneyOf } from '../lib/roles'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type ChairTime = Schemas['SlotsViewChairTime']

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
export function DayList({ me, doctors, date, onDate, onOpen, onNew, onNewHere, selectedId, all, doctorsNote }: {
  me: Me
  doctors: Doctor[]
  date: string
  onDate: (date: string) => void
  onOpen: (a: Appointment) => void
  onNew: (doctorId: number, minutes: number) => void
  /** «＋ Новая запись» на этот день (врач и время — в форме). */
  onNewHere?: () => void
  selectedId?: number
  /** «Все врачи», даже если колонка одна (остальные скрыты или выходной): шапка врача у колонки остаётся */
  all?: boolean
  /** «Показано 4 из 10 · Выходной: Айгерим · показать» (SchedulePage) */
  doctorsNote?: ReactNode
}) {
  const today = todayIn()
  const many = all ?? doctors.length > 1
  // Свайпы по строке — телефон (тач или узкий экран); у «Все врачи» колонки сами листаются вбок — без свайпов
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
    ...list.filter((a) => a.doctorId === d.id).map((a) => ({ kind: 'appointment' as const, at: a.startAt!, a, chair: colleagueTimeOf(a, slots[i]?.data?.chairTime) })),
    ...(slots[i]?.data?.free ?? []).map((w) => ({ kind: 'free' as const, at: w.start!, end: w.end!, doctorId: d.id })),
    ...(slots[i]?.data?.breaks ?? []).map((b) => ({ kind: 'pause' as const, at: b.start!, end: b.end!, title: b.title ?? '', emoji: b.emoji ?? '', doctorId: d.id })),
    // Часы коллеги по креслу (V187): записать можно, сервер спросит «Коллега предупреждён?». В часах врача — всегда,
    // вне их и в выходной — только если там его приём (listedChairTime): без шума от пустого вечера коллеги
    ...listedChairTime(slots[i]?.data, date, list.filter((a) => a.doctorId === d.id))
      .map((t) => ({ kind: 'colleague' as const, at: t.start!, end: t.end!, name: t.doctorName ?? '', doctorId: d.id })),
  ].sort((x, y) => x.at.localeCompare(y.at))
  const groups = doctors.map((d, i) => ({ doctor: d, items: itemsOf(d, i), booked: list.filter((a) => a.doctorId === d.id).length }))
  const items = groups.flatMap((g) => g.items)
  const scheduled = list.filter((a) => a.status === 'SCHEDULED')
  const ready = scheduled.filter((a) => a.reminderOpenedAt || (a.reply && a.reply !== 'NONE')).length
  const now = new Date().toISOString()
  const next = date === today ? [...list].sort((x, y) => x.startAt!.localeCompare(y.startAt!)).find((a) => a.status === 'SCHEDULED' && a.startAt! > now) : undefined
  const off = doctors.filter((_, i) => slots[i]?.data && !slots[i]!.data!.workingDay)
  const offText = single ? (off.length ? (slots[0]!.data!.dayOff ? `${slots[0]!.data!.dayOff.emoji ?? ''} ${slots[0]!.data!.dayOff.title ?? ''}` : 'Выходной') : null)
    : off.length ? `Не работают: ${off.map((d) => nameOf.get(d.id)).join(', ')}` : null
  const note = [
    offText,
    date === addDays(today, 1) && scheduled.length ? `Готово ${ready} из ${scheduled.length}` : null,
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
    <div className="day-list">
      {/* Один день крупно: стрелки — на день назад и вперёд, нажать на дату — календарь, «Сегодня» — назад */}
      <div className="date-bar" role="group" aria-label="День">
        <button type="button" className="date-step" aria-label="Предыдущий день" onClick={() => onDate(addDays(date, -1))}>‹</button>
        {/* Нажать на дату — месяц листом снизу (число записей по дням), как вид «Месяц» */}
        <button type="button" className="date-pick" aria-label={`${title.main}, ${title.sub}: выбрать день`} aria-haspopup="dialog"
          onClick={() => setMonthOpen(true)}>
          <span className="date-main">{title.main} <span className="date-caret" aria-hidden="true">▾</span></span>
          <span className="date-sub">{title.sub}</span>
        </button>
        <button type="button" className="date-step" aria-label="Следующий день" onClick={() => onDate(addDays(date, 1))}>›</button>
        {date !== today && <button type="button" className="btn small date-today" onClick={() => onDate(today)}>Сегодня</button>}
      </div>
      {monthOpen && <MonthSheet date={date} today={today} doctorIds={doctors.map((d) => d.id)} onPick={onDate} onClose={() => setMonthOpen(false)} />}
      {single && !canEditDoctor(single.id) && <p className="readonly-note">Расписание коллеги — только просмотр</p>}
      {/* Пришёл без записи — та же «Новая запись», в ней «⚡ Сейчас» */}
      {onNewHere && <div className="day-actions"><button type="button" className="btn primary" data-tour="new-appointment" onClick={onNewHere}>＋ Новая запись</button></div>}
      {/* Одной строкой: «Не работают: … · Показано 6 из 10 · Выходной: … показать» */}
      {(note || doctorsNote) && <p className="hint day-note">{note}{note && doctorsNote ? ' · ' : ''}{doctorsNote}</p>}
      {pending ? <Loading />
        : failed ? <p className="error">{failed.message}</p>
          : items.length === 0 ? (
            <>
              <EmptyState title={emptyDayText(date, today)}>{offText}</EmptyState>
              <CancelledList items={cancelled} onOpen={onOpen} selectedId={selectedId} doctorName={many ? (id) => nameOf.get(id) ?? '' : undefined} />
            </>
          ) : (() => {
            const blocks = groups.map((g) => {
              const rows = (
                <>
                  {swipe && g.items.some((i) => i.kind === 'appointment') && <SwipeHint />}
                  <ul className="rows">
                    {g.items.map((item) => item.kind === 'appointment'
                      ? <Row key={`a${item.a.id}`} a={item.a} color={g.doctor.color} chair={item.chair} next={item.a === next} active={item.a.id === selectedId}
                          canEdit={canEditDoctor(item.a.doctorId!)} money={seesMoneyOf(me, item.a.doctorId)} onOpen={onOpen} swipe={swipe} />
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
                          doctor={many ? g.doctor.name : undefined}
                          onPick={() => onNew(item.doctorId, minutesOf(item.at))} />
                      ))}
                    {g.items.length === 0 && <li className="hint day-empty">Нет записей</li>}
                  </ul>
                  <CancelledList items={cancelled.filter((a) => a.doctorId === g.doctor.id)} onOpen={onOpen} selectedId={selectedId} />
                </>
              )
              // «Все врачи» — у каждого врача свой блок; имя прилипает сверху при прокрутке
              return many ? (
                <section key={g.doctor.id} className="doctor-day" aria-label={g.doctor.name}>
                  <h3 className="doctor-day-head" title={g.doctor.name}>
                    <span className="avatar" style={g.doctor.color ? { background: g.doctor.color, color: '#fff' } : undefined} aria-hidden="true">{g.doctor.name.slice(0, 1)}</span>
                    <span className="doctor-day-name">{shortName(g.doctor.name)}{g.doctor.id === me.doctorId ? ' (я)' : ''}</span>
                    <span className="doctor-day-count" aria-label={`записей: ${g.booked}`}>{g.booked}</span>
                  </h3>
                  {rows}
                </section>
              ) : <div key={g.doctor.id}>{rows}</div>
            })
            // Приёмов нет, но есть свободные окна: врачи и окна — сверху (сразу видно, куда записать),
            // Тишка «На сегодня записей нет» — под ними
            const empty = list.length === 0 && (
              <EmptyState title={emptyDayText(date, today)}>{offText ?? (date >= today ? 'Нажмите на свободное окно выше, чтобы записать.' : null)}</EmptyState>
            )
            // «Все врачи» — списки врачей рядом, колонками; две — по половине экрана, больше двух — третья
            // выглядывает краем (peek: видно, что можно листать) и колонки листаются вбок
            return <>{many ? (
              // key={order}: сменили порядок — колонки строятся заново, а не переставляются внутри прокрутки. iPhone
              // (WebKit) при перестановке в прокручиваемом блоке со scroll-snap оставлял «призрак» прежней колонки
              // поверх соседней, пока экран не перерисуется
              <div key={order} ref={columns} className={groups.length > 2 ? 'doctor-columns peek' : 'doctor-columns'} style={{ '--cols': groups.length } as CSSProperties}>{blocks}</div>
            ) : blocks}{empty}</>
          })()}
    </div>
  )
}

function FreeRow({ start, end, canEdit, doctor, onPick }: {
  start: string
  end: string
  canEdit: boolean
  /** «Все врачи» (узкая колонка): коротко «до 13:00» */
  doctor?: string
  onPick: () => void
}) {
  const text = <>{doctor ? 'до' : 'свободно до'} {timeOf(end)}</>
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
function Row({ a, color, chair, next, active, canEdit, money, onOpen, swipe = false }: {
  a: Appointment
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
  /** Телефон: свайп вправо — напомнить, влево — «Приём состоялся» */
  swipe?: boolean
}) {
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  // Статус — отдельной мутацией: успех «состоялся» не должен выглядеть как «напоминание отправлено»
  const status = useAppointmentAction(a)
  const [undo, setUndo] = useState<Appointment | null>(null)
  const li = useRef<HTMLLIElement>(null)
  const text = useReminderText()
  const opened = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id! } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const s = statusOf(a)
  const canRemind = canEdit && a.status === 'SCHEDULED' && a.endAt != null && new Date(a.endAt) > new Date()
  const viaBot = Boolean(a.patient?.telegram)
  const notSent = useReminderNotSent(a)
  // После «не ушло» — снова кнопка, даже если успех нажатия ещё в памяти
  const sent = !notSent.undo.isSuccess && (Boolean(a.reminderOpenedAt) || action.isSuccess || opened.isSuccess)
  const busy = action.isPending || opened.isPending || (!viaBot && !text)
  const remind = () => {
    if (busy || sent) return
    notSent.undo.reset()
    if (viaBot) {
      action.mutate({ kind: 'remindTelegram' })
      return
    }
    opened.mutate()
    openLink(whatsappUrl(contactPhone(a.patient) ?? '', text?.(a) ?? ''))
  }
  // Свайп вправо — то же, что быстрая кнопка; есть, пока она есть (не отправлено, есть номер или бот)
  const canSwipeRemind = canRemind && !sent && !busy && (viaBot || Boolean(contactPhone(a.patient)))
  // Свайп влево — «Приём состоялся»: свой/доступный приём, запланирован и уже начался
  const canSwipeDone = canEdit && a.status === 'SCHEDULED' && new Date(a.startAt!) <= new Date() && !status.isPending
  const done = () => status.mutate({ kind: 'status', body: { version: a.version ?? 0, status: 'DONE' } }, { onSuccess: (updated) => setUndo(updated) })
  const back = () => undo && status.mutate({ kind: 'undo', body: { version: undo.version ?? 0, previousStatus: 'SCHEDULED' } },
    { onSuccess: () => setUndo(null) })
  useRowSwipe(li, swipe, { right: canSwipeRemind ? () => { hideSwipeHint(); remind() } : undefined, left: canSwipeDone ? () => { hideSwipeHint(); done() } : undefined })
  // «Вернуть» — недолго, как тост
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 10_000)
    return () => clearTimeout(t)
  }, [undo])
  const error = action.error ?? opened.error ?? notSent.undo.error
  const statusError = status.error
  return (
    <li ref={li} className={['row', `s-${s.kind}`, next ? 'next' : '', active ? 'active' : '', a.status === 'NO_SHOW' ? 'struck' : '', swipe ? 'swipe' : '', color ? 'doc' : ''].join(' ').trim()}
      style={color ? { '--doc': color } as CSSProperties : undefined}>
      {swipe && canSwipeRemind && <span className="swipe-under swipe-right" aria-hidden="true">💬 Напомнить</span>}
      {swipe && canSwipeDone && <span className="swipe-under swipe-left" aria-hidden="true">✅ Состоялся</span>}
      <div className="row-slide">
        <button type="button" className="row-button" onClick={() => onOpen(a)}
          aria-label={`${timeOf(a.startAt!)}–${timeOf(a.endAt!)}, ${a.patient?.fullName}: ${s.label}${chair ? `. ${colleagueMarkText(chair)}` : ''}`}>
          <span className="time num">{timeOf(a.startAt!)}</span>
          <span className="name">{a.patient?.fullName} <ApptBadges appointment={a} money={money} /></span>
          <span className="end num hint">{timeOf(a.endAt!)}</span>
          <span className={`state tone-${s.tone}`}><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}{a.serviceName ? <span className="hint"> · {serviceEmoji(a.serviceName)} {a.serviceName}</span> : null}</span>
          {chair && (
            <span className="row-note chair-mark" title={colleagueMarkText(chair)}>
              <span aria-hidden="true">🪑 </span>время {shortName(chair.doctorName ?? 'коллеги')}
            </span>
          )}
          {a.comment && <span className="row-note">{a.comment}</span>}
          {a.depositStatus && money && ['REQUESTED', 'SCHEDULED'].includes(a.status ?? '') && (
            <span className={`row-note tone-${a.depositStatus === 'RECEIVED' ? 'ok' : 'wait'}`}>
              Предоплата {somText(a.depositSom ?? 0)} · {a.depositStatus === 'RECEIVED' ? 'получена' : a.depositStatus === 'REPORTED' ? 'пациент оплатил — проверьте' : 'ждём'}
            </span>
          )}
        </button>
        {canRemind && (sent ? (
          <button type="button" className="remind-sent tone-ok" disabled={notSent.undo.isPending} onClick={notSent.run}
            aria-label={`Напоминание отправлено: ${a.patient?.fullName}. Не ушло? Снять отметку`}>✓ отправлено</button>
        ) : (
          <button type="button" className={viaBot ? 'remind-quick tg' : 'remind-quick'} disabled={busy}
            aria-label={`${viaBot ? 'Напомнить в Telegram' : 'Напомнить в WhatsApp'}: ${a.patient?.fullName}, ${timeOf(a.startAt!)}`}
            onClick={remind}>{viaBot ? 'TG' : 'WA'}</button>
        ))}
      </div>
      {canRemind && error && <p className="error row-error" role="alert">{error.message}</p>}
      {statusError && <p className="error row-error" role="alert">{statusError.message}</p>}
      {undo && (
        <div className="undo row-undo" role="status">
          <span>Приём состоялся: {a.patient?.fullName}</span>
          <button type="button" className="btn small" disabled={status.isPending} onClick={back}>Вернуть</button>
        </div>
      )}
    </li>
  )
}

/** Свайпы: тач-экран или узкое окно (на компьютере — кнопки) */
const SWIPE_MEDIA = '(max-width: 720px), (pointer: coarse)'
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
      <span>Подсказка: свайп вправо — напомнить, влево — приём состоялся</span>
      <button type="button" className="btn ghost small" aria-label="Закрыть подсказку" onClick={hideSwipeHint}>✕</button>
    </p>
  )
}
