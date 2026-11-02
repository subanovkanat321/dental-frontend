import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, type CSSProperties } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useWaitlist } from '../api/settings'
import { reminderText, whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { addDays, minutesOf, somText, timeOf, todayIn } from '../lib/time'
import { serviceEmoji } from '../lib/serviceEmoji'
import { statusOf } from './status'
import { useAppointmentAction } from './useAppointmentAction'
import { canEditDoctor as canEdit } from '../lib/roles'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Waiting = Schemas['WaitlistView']

type Item =
  | { kind: 'appointment'; at: string; a: Appointment }
  | { kind: 'free'; at: string; end: string; doctorId: number }
  | { kind: 'pause'; at: string; end: string; title: string; emoji: string; doctorId: number }

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' })
const MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const monthOf = (d: string) => MONTH.format(new Date(`${d}T00:00:00Z`)).replace('.', '')

/** Лента дней: неделя назад и три вперёд; число — сколько записей, оранжевое — есть заявки. */
function stripDays(today: string): string[] {
  return Array.from({ length: 28 }, (_, i) => addDays(today, i - 7))
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
 * «День» списком — как в прежнем приложении на телефоне: лента дней с числом записей,
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
  const days = stripDays(today)
  const counts = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['counts', d.id, days[0]],
      queryFn: () => unwrap(api.GET('/api/appointments/counts', { params: { query: { from: days[0]!, days: days.length, doctorId: d.id } } })),
      staleTime: 60_000,
    })),
  })
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
  const seesAllMoney = Boolean(me.admin) && !me.clinic?.independentDoctors
  const seesMoney = single ? seesAllMoney || single.id === me.doctorId : seesAllMoney
  const list = appointments.flatMap((q) => q.data ?? []).filter((a) => a.status !== 'CANCELLED')
  const revenue = useQuery({
    queryKey: ['revenue', date, date, single?.id ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: date, to: date, ...(single ? { doctorId: single.id } : {}) } } })),
    enabled: seesMoney && date <= today && list.some((a) => a.status === 'DONE'),
  })
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    strip.current?.querySelector('[aria-pressed=true]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [date])

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
  const walkInDoctor = doctors.find((d) => d.id === me.doctorId) ?? doctors.find((d) => canEditDoctor(d.id))
  const pending = appointments.some((q) => q.isPending) || slots.some((q) => q.isPending)
  const failed = appointments.find((q) => q.error)?.error

  return (
    <div className="day-list">
      <div ref={strip} className="strip" role="group" aria-label="Дни">
        {days.map((d, i) => {
          const booked = counts.reduce((sum, q) => sum + (q.data?.[i]?.booked ?? 0), 0)
          const requested = counts.some((q) => q.data?.[i]?.requested)
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
          return (
            <button key={d} type="button" className={['strip-day', d === today ? 'today' : '', wd === 0 || wd === 6 ? 'weekend' : ''].join(' ').trim()}
              aria-pressed={d === date} onClick={() => onDate(d)}
              aria-label={`${d === today ? 'Сегодня' : WEEKDAY.format(new Date(`${d}T00:00:00Z`))}, ${Number(d.slice(8))}${booked ? `: записей ${booked}` : ''}`}>
              <span className="wd">{d === today ? 'Сегодня' : WEEKDAY.format(new Date(`${d}T00:00:00Z`)).replace(/^./, (x) => x.toUpperCase())}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className="mn">{monthOf(d)}</span>
              <span className={requested ? 'badge requested' : 'badge'} aria-hidden="true">{booked || ''}</span>
            </button>
          )
        })}
        {/* Любой другой день — календарём; выбран день вне ленты — он здесь и подсвечен */}
        <label className={days.includes(date) ? "strip-day pick" : "strip-day pick active"}>
          {days.includes(date) ? <><span className="wd">Другой</span><span className="dn" aria-hidden="true">📅</span><span className="mn">день</span></>
            : <><span className="wd">{WEEKDAY.format(new Date(`${date}T00:00:00Z`)).replace(/^./, (x) => x.toUpperCase())}</span>
              <span className="dn">{Number(date.slice(8))}</span><span className="mn">{monthOf(date)}</span></>}
          <input type="date" aria-label="Выбрать дату" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} />
        </label>
      </div>
      {single && !canEditDoctor(single.id) && <p className="readonly-note">Расписание коллеги — только просмотр</p>}
      <div className="day-actions">
        {onNewHere && <button type="button" className="btn primary" onClick={onNewHere}>＋ Новая запись</button>}
        {date === today && walkInDoctor && (
          <button type="button" className="btn walk-in" aria-label="Принять сейчас (без записи)"
            onClick={() => onNew(walkInDoctor.id, minutesOf(new Date().toISOString()), true)}>{onNewHere ? '⚡ Без записи' : '🚶 Принять сейчас (без записи)'}</button>
        )}
      </div>
      {note && <p className="hint day-note">{note}</p>}
      {pending ? <p className="hint">Загрузка…</p>
        : failed ? <p className="error">{failed.message}</p>
          : items.length === 0 ? <p className="day-empty hint">{offText ? `${offText} — записей нет` : 'На этот день записей нет'}</p> : (() => {
            const blocks = groups.map((g) => {
              const rows = (
                <ul className="rows">
                  {g.items.map((item) => item.kind === 'appointment'
                    ? <Row key={`a${item.a.id}`} a={item.a} next={item.a === next} active={item.a.id === selectedId}
                        canEdit={canEditDoctor(item.a.doctorId!)} onOpen={onOpen} />
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
            // «Все врачи» — списки врачей рядом, колонками; больше двух — листаются вбок
            return many ? <div className="doctor-columns" style={{ '--cols': groups.length } as CSSProperties}>{blocks}</div> : blocks
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

/** Строка приёма: время, пациент, статус; быстрая кнопка напомнить (бот — в Telegram, иначе WhatsApp). */
function Row({ a, next, active, canEdit, onOpen }: {
  a: Appointment
  next: boolean
  active: boolean
  canEdit: boolean
  onOpen: (a: Appointment) => void
}) {
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => unwrap(api.GET('/api/settings')), staleTime: 10 * 60_000 })
  const opened = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id! } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const s = statusOf(a)
  const canRemind = canEdit && a.status === 'SCHEDULED' && a.endAt != null && new Date(a.endAt) > new Date()
  const viaBot = Boolean(a.patient?.telegram)
  const remind = () => {
    if (viaBot) {
      action.mutate({ kind: 'remindTelegram' })
      return
    }
    opened.mutate()
    openLink(whatsappUrl(a.patient?.phone ?? '', reminderText({ startAt: a.startAt!, patient: a.patient ?? {} },
      settings.data?.clinicSignature, settings.data?.botUrl)))
  }
  return (
    <li className={['row', `s-${s.kind}`, next ? 'next' : '', active ? 'active' : '', a.status === 'NO_SHOW' ? 'struck' : ''].join(' ').trim()}>
      <button type="button" className="row-button" onClick={() => onOpen(a)}
        aria-label={`${timeOf(a.startAt!)}–${timeOf(a.endAt!)}, ${a.patient?.fullName}: ${s.label}`}>
        <span className="time num">{timeOf(a.startAt!)}</span>
        <span className="name">{a.patient?.fullName}</span>
        <span className="end num hint">{timeOf(a.endAt!)}</span>
        <span className={`state tone-${s.tone}`}><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}{a.serviceName ? <span className="hint"> · {serviceEmoji(a.serviceName)} {a.serviceName}</span> : null}</span>
        {a.comment && <span className="row-note">{a.comment}</span>}
        {a.depositStatus && ['REQUESTED', 'SCHEDULED'].includes(a.status ?? '') && (
          <span className={`row-note tone-${a.depositStatus === 'RECEIVED' ? 'ok' : 'wait'}`}>
            Предоплата {somText(a.depositSom ?? 0)} · {a.depositStatus === 'RECEIVED' ? 'получена' : a.depositStatus === 'REPORTED' ? 'пациент оплатил — проверьте' : 'ждём'}
          </span>
        )}
      </button>
      {canRemind && (
        <button type="button" className={viaBot ? 'remind-quick tg' : 'remind-quick'} disabled={action.isPending}
          aria-label={`${viaBot ? 'Напомнить в Telegram' : 'Напомнить в WhatsApp'}: ${a.patient?.fullName}, ${timeOf(a.startAt!)}`}
          onClick={remind}>{viaBot ? 'TG' : 'WA'}</button>
      )}
    </li>
  )
}
