import { ApptBadges } from './ApptBadges'
import { CancelledList } from './CancelledList'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CSSProperties } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useReminderNotSent } from './useReminderNotSent'
import { useReminderText, useWaitlist } from '../api/settings'
import { whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { addDays, emptyDayText, minutesOf, nowMinutes5, somText, timeOf, todayIn } from '../lib/time'
import { serviceEmoji } from '../lib/serviceEmoji'
import { DateInput } from '../layout/DateInput'
import { statusOf } from './status'
import { useAppointmentAction } from './useAppointmentAction'
import { canEditDoctor as canEdit, seesMoneyOf, seesAllMoney as seesAllMoneyOf } from '../lib/roles'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Waiting = Schemas['WaitlistView']

type Item =
  | { kind: 'appointment'; at: string; a: Appointment }
  | { kind: 'free'; at: string; end: string; doctorId: number }
  | { kind: 'pause'; at: string; end: string; title: string; emoji: string; doctorId: number }

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

/** Пациент из листа ожидания помещается в окно: по длительности и, если уже записан, окно раньше его приёма. */
function fits(w: Waiting, start: string, end: string, doctorId: number): boolean {
  if (w.doctorId != null && w.doctorId !== doctorId) return false
  const sameDoctor = !w.upcoming || w.upcoming.doctorId === doctorId
  const earlier = !w.upcoming?.startAt || !sameDoctor || start < w.upcoming.startAt
  return earlier && (w.durationMinutes ?? 30) <= (Date.parse(end) - Date.parse(start)) / 60_000
}

type Doctor = { id: number; name: string }

/** «Нурболот Асанов» → «Нурболот»: в строке списка мало места. */
function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/**
 * «День» списком — как в прежнем приложении на телефоне: один день крупно (листать стрелками, любой — календарём),
 * «Принять сейчас», строки по времени — приёмы, «свободно до …» (нажать — записать) и перерывы.
 * Один врач — его день; «Все врачи» — все приёмы вместе, у строки имя врача, свободные окна
 * каждого врача отдельно. У приёма — быстрое напоминание (Telegram или WhatsApp). Завтра — «Готово X из Y».
 */
export function DayList({ me, doctors, date, onDate, onOpen, onNew, onNewHere, selectedId }: {
  me: Me
  doctors: Doctor[]
  date: string
  onDate: (date: string) => void
  onOpen: (a: Appointment) => void
  onNew: (doctorId: number, minutes: number, walkIn?: boolean) => void
  /** «＋ Новая запись» на этот день (врач и время — в форме). */
  onNewHere?: () => void
  selectedId?: number
}) {
  const today = todayIn()
  const many = doctors.length > 1
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
  const waitlist = useWaitlist()
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
    ...list.filter((a) => a.doctorId === d.id).map((a) => ({ kind: 'appointment' as const, at: a.startAt!, a })),
    ...(slots[i]?.data?.free ?? []).map((w) => ({ kind: 'free' as const, at: w.start!, end: w.end!, doctorId: d.id })),
    ...(slots[i]?.data?.breaks ?? []).map((b) => ({ kind: 'pause' as const, at: b.start!, end: b.end!, title: b.title ?? '', emoji: b.emoji ?? '', doctorId: d.id })),
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
  const walkInDoctor = doctors.find((d) => d.id === me.doctorId) ?? doctors.find((d) => canEditDoctor(d.id))
  const pending = appointments.some((q) => q.isPending) || slots.some((q) => q.isPending)
  const failed = appointments.find((q) => q.error)?.error

  return (
    <div className="day-list">
      {/* Один день крупно: стрелки — на день назад и вперёд, нажать на дату — календарь, «Сегодня» — назад */}
      <div className="date-bar" role="group" aria-label="День">
        <button type="button" className="date-step" aria-label="Предыдущий день" onClick={() => onDate(addDays(date, -1))}>‹</button>
        {/* Наш календарь, не системный: невидимая кнопка поверх даты — нажатие по дате открывает его */}
        <div className="date-pick">
          <span className="date-main">{title.main} <span className="date-caret" aria-hidden="true">▾</span></span>
          <span className="date-sub">{title.sub}</span>
          <DateInput iconOnly required className="date-pick-input" aria-label="Выбрать дату" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} />
        </div>
        <button type="button" className="date-step" aria-label="Следующий день" onClick={() => onDate(addDays(date, 1))}>›</button>
        {date !== today && <button type="button" className="btn small date-today" onClick={() => onDate(today)}>Сегодня</button>}
      </div>
      {single && !canEditDoctor(single.id) && <p className="readonly-note">Расписание коллеги — только просмотр</p>}
      <div className="day-actions">
        {onNewHere && <button type="button" className="btn primary" onClick={onNewHere}>＋ Новая запись</button>}
        {date === today && walkInDoctor && (
          <button type="button" className="btn walk-in" aria-label="Принять сейчас (без записи)"
            onClick={() => onNew(walkInDoctor.id, nowMinutes5(), true)}>{onNewHere ? '⚡ Без записи' : '🚶 Принять сейчас (без записи)'}</button>
        )}
      </div>
      {note && <p className="hint day-note">{note}</p>}
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
                  <ul className="rows">
                    {g.items.map((item) => item.kind === 'appointment'
                      ? <Row key={`a${item.a.id}`} a={item.a} next={item.a === next} active={item.a.id === selectedId}
                          canEdit={canEditDoctor(item.a.doctorId!)} money={seesMoneyOf(me, item.a.doctorId)} onOpen={onOpen} />
                      : item.kind === 'pause' ? (
                        <li key={`p${item.at}`} className="row pause">
                          <span className="time num">{timeOf(item.at)}</span>
                          <span className="name"><span aria-hidden="true">{item.emoji} </span>{item.title}</span>
                          <span className="end num hint">{timeOf(item.end)}</span>
                        </li>
                      ) : (
                        <FreeRow key={`f${item.at}`} start={item.at} end={item.end} canEdit={canEditDoctor(item.doctorId)}
                          doctor={many ? g.doctor.name : undefined}
                          waiting={(waitlist.data ?? []).filter((w) => fits(w, item.at, item.end, item.doctorId)).length}
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
                    <span className="avatar" aria-hidden="true">{g.doctor.name.slice(0, 1)}</span>
                    <span className="doctor-day-name">{shortName(g.doctor.name)}{g.doctor.id === me.doctorId ? ' (я)' : ''}</span>
                    <span className="doctor-day-count" aria-label={`записей: ${g.booked}`}>{g.booked}</span>
                  </h3>
                  {rows}
                </section>
              ) : <div key={g.doctor.id}>{rows}</div>
            })
            // Приёмов нет, но есть свободные окна: Тишка и «На сегодня записей нет», окна — ниже (нажать — записать)
            const empty = list.length === 0 && (
              <EmptyState title={emptyDayText(date, today)}>{offText ?? (date >= today ? 'Нажмите на свободное окно ниже, чтобы записать.' : null)}</EmptyState>
            )
            // «Все врачи» — списки врачей рядом, колонками; больше двух — листаются вбок
            return <>{empty}{many ? <div className="doctor-columns" style={{ '--cols': groups.length } as CSSProperties}>{blocks}</div> : blocks}</>
          })()}
    </div>
  )
}

function FreeRow({ start, end, canEdit, doctor, waiting, onPick }: {
  start: string
  end: string
  canEdit: boolean
  /** «Все врачи» (узкая колонка): коротко «до 13:00» */
  doctor?: string
  waiting: number
  onPick: () => void
}) {
  const text = <>{doctor ? 'до' : 'свободно до'} {timeOf(end)}{waiting > 0 && <span className="waiting"> · ждут: {waiting}</span>}</>
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
 */
function Row({ a, next, active, canEdit, money, onOpen }: {
  a: Appointment
  /** Видит ли деньги этого приёма (seesMoneyOf): иначе сервер прислал их пустыми — строки «предоплата» нет */
  money: boolean
  next: boolean
  active: boolean
  canEdit: boolean
  onOpen: (a: Appointment) => void
}) {
  const client = useQueryClient()
  const action = useAppointmentAction(a)
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
    openLink(whatsappUrl(a.patient?.phone ?? '', text?.(a) ?? ''))
  }
  const error = action.error ?? opened.error ?? notSent.undo.error
  return (
    <li className={['row', `s-${s.kind}`, next ? 'next' : '', active ? 'active' : '', a.status === 'NO_SHOW' ? 'struck' : ''].join(' ').trim()}>
      <button type="button" className="row-button" onClick={() => onOpen(a)}
        aria-label={`${timeOf(a.startAt!)}–${timeOf(a.endAt!)}, ${a.patient?.fullName}: ${s.label}`}>
        <span className="time num">{timeOf(a.startAt!)}</span>
        <span className="name">{a.patient?.fullName} <ApptBadges appointment={a} money={money} /></span>
        <span className="end num hint">{timeOf(a.endAt!)}</span>
        <span className={`state tone-${s.tone}`}><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}{a.serviceName ? <span className="hint"> · {serviceEmoji(a.serviceName)} {a.serviceName}</span> : null}</span>
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
      {canRemind && error && <p className="error row-error" role="alert">{error.message}</p>}
    </li>
  )
}
