import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useWaitlist } from '../api/settings'
import { reminderText, whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { addDays, minutesOf, somText, timeOf, todayIn } from '../lib/time'
import { statusOf } from './status'
import { useAppointmentAction } from './useAppointmentAction'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Waiting = Schemas['WaitlistView']

type Item =
  | { kind: 'appointment'; at: string; a: Appointment }
  | { kind: 'free'; at: string; end: string }
  | { kind: 'pause'; at: string; end: string; title: string; emoji: string }

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' })

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

/**
 * «День» одного врача — как в прежнем приложении на телефоне: лента дней с числом записей,
 * «Принять сейчас», строки по времени — приёмы, «свободно до …» (нажать — записать) и перерывы.
 * У приёма — быстрое напоминание (Telegram или WhatsApp). Завтра — «Готово X из Y».
 */
export function DayList({ me, doctorId, date, onDate, onOpen, onNew, selectedId }: {
  me: Me
  doctorId: number
  date: string
  onDate: (date: string) => void
  onOpen: (a: Appointment) => void
  onNew: (minutes: number, walkIn?: boolean) => void
  selectedId?: number
}) {
  const today = todayIn()
  const canEdit = Boolean(me.admin || me.reception || doctorId === me.doctorId)
  const days = stripDays(today)
  const counts = useQuery({
    queryKey: ['counts', doctorId, days[0]],
    queryFn: () => unwrap(api.GET('/api/appointments/counts', { params: { query: { from: days[0]!, days: days.length, doctorId } } })),
    staleTime: 60_000,
  })
  const appointments = useQuery({
    queryKey: ['appointments', date, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments', { params: { query: { date, doctorId } } })),
    refetchInterval: 60_000,
  })
  const slots = useQuery({
    queryKey: ['slots', date, doctorId],
    queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId } } })),
  })
  const waitlist = useWaitlist()
  const seesMoney = (Boolean(me.admin) && !me.clinic?.independentDoctors) || doctorId === me.doctorId
  const list = (appointments.data ?? []).filter((a) => a.status !== 'CANCELLED')
  const revenue = useQuery({
    queryKey: ['revenue', date, date, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: date, to: date, doctorId } } })),
    enabled: seesMoney && date <= today && list.some((a) => a.status === 'DONE'),
  })
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    strip.current?.querySelector('[aria-pressed=true]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [date])

  const s = slots.data
  const items: Item[] = [
    ...list.map((a) => ({ kind: 'appointment' as const, at: a.startAt!, a })),
    ...(s?.free ?? []).map((w) => ({ kind: 'free' as const, at: w.start!, end: w.end! })),
    ...(s?.breaks ?? []).map((b) => ({ kind: 'pause' as const, at: b.start!, end: b.end!, title: b.title ?? '', emoji: b.emoji ?? '' })),
  ].sort((x, y) => x.at.localeCompare(y.at))
  const scheduled = list.filter((a) => a.status === 'SCHEDULED')
  const ready = scheduled.filter((a) => a.reminderOpenedAt || (a.reply && a.reply !== 'NONE')).length
  const now = new Date().toISOString()
  const next = date === today ? list.find((a) => a.status === 'SCHEDULED' && a.startAt! > now) : undefined
  const note = [
    s && !s.workingDay ? (s.dayOff ? `${s.dayOff.emoji ?? ''} ${s.dayOff.title ?? ''}` : 'Выходной') : null,
    date === addDays(today, 1) && scheduled.length ? `Готово ${ready} из ${scheduled.length}` : null,
    revenue.data?.totalSom ? `За день: ${somText(revenue.data.totalSom)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="day-list">
      <div ref={strip} className="strip" role="group" aria-label="Дни">
        {days.map((d, i) => {
          const c = counts.data?.[i]
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay()
          return (
            <button key={d} type="button" className={['strip-day', d === today ? 'today' : '', wd === 0 || wd === 6 ? 'weekend' : ''].join(' ').trim()}
              aria-pressed={d === date} onClick={() => onDate(d)}
              aria-label={`${d === today ? 'Сегодня' : WEEKDAY.format(new Date(`${d}T00:00:00Z`))}, ${Number(d.slice(8))}${c?.booked ? `: записей ${c.booked}` : ''}`}>
              <span className="wd">{d === today ? 'Сегодня' : WEEKDAY.format(new Date(`${d}T00:00:00Z`)).replace(/^./, (x) => x.toUpperCase())}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className={c?.requested ? 'badge requested' : 'badge'} aria-hidden="true">{c?.booked ? c.booked : ''}</span>
            </button>
          )
        })}
      </div>
      {!canEdit && <p className="readonly-note">Расписание коллеги — только просмотр</p>}
      {date === today && canEdit && (
        <button type="button" className="btn walk-in" onClick={() => onNew(minutesOf(new Date().toISOString()), true)}>Принять сейчас (без записи)</button>
      )}
      {note && <p className="hint day-note">{note}</p>}
      {appointments.isPending || slots.isPending ? <p className="hint">Загрузка…</p>
        : appointments.error ? <p className="error">{appointments.error.message}</p>
          : items.length === 0 ? <p className="day-empty hint">{s?.dayOff ? `${s.dayOff.title} — записей нет` : s && !s.workingDay ? 'Выходной' : 'На этот день записей нет'}</p> : (
            <ul className="rows">
              {items.map((item) => item.kind === 'appointment'
                ? <Row key={`a${item.a.id}`} a={item.a} next={item.a === next} active={item.a.id === selectedId} canEdit={canEdit} onOpen={onOpen} />
                : item.kind === 'pause' ? (
                  <li key={`p${item.at}`} className="row pause">
                    <span className="time num">{timeOf(item.at)}</span>
                    <span className="name"><span aria-hidden="true">{item.emoji} </span>{item.title}</span>
                    <span className="end num hint">{timeOf(item.end)}</span>
                  </li>
                ) : (
                  <FreeRow key={`f${item.at}`} start={item.at} end={item.end} canEdit={canEdit}
                    waiting={(waitlist.data ?? []).filter((w) => fits(w, item.at, item.end, doctorId)).length}
                    onPick={() => onNew(minutesOf(item.at))} />
                ))}
            </ul>
          )}
    </div>
  )
}

function FreeRow({ start, end, canEdit, waiting, onPick }: { start: string; end: string; canEdit: boolean; waiting: number; onPick: () => void }) {
  const text = <>свободно до {timeOf(end)}{waiting > 0 && <span className="waiting"> · ждут: {waiting}</span>}</>
  if (!canEdit) return <li className="row free readonly"><span className="time num">{timeOf(start)}</span><span className="hint">{text}</span></li>
  return (
    <li className="row free">
      <button type="button" className="row-button" aria-label={`Свободно с ${timeOf(start)} до ${timeOf(end)}, записать`} onClick={onPick}>
        <span className="time num">{timeOf(start)}</span><span className="hint">{text}</span><span className="plus" aria-hidden="true">＋</span>
      </button>
    </li>
  )
}

/** Строка приёма: время, пациент, статус; быстрая кнопка напомнить (бот — в Telegram, иначе WhatsApp). */
function Row({ a, next, active, canEdit, onOpen }: { a: Appointment; next: boolean; active: boolean; canEdit: boolean; onOpen: (a: Appointment) => void }) {
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
        <span className={`state tone-${s.tone}`}><span className="dot" /> {s.label}{a.serviceName ? <span className="hint"> · {a.serviceName}</span> : null}</span>
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
