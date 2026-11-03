import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

import type { Schemas } from '../../api/client'
import { canEditDoctor } from '../../lib/roles'
import { dateOf, dayTitle, minutesOf, minutesOfTime, timeOf } from '../../lib/time'
import { hhmm, PAD, PX, useNowMinutes } from '../gridScale'
import { statusOf } from '../status'
import { useDrag } from './useDrag'
import { useMove, type Move } from './useMove'
import { useWeekAppointments, useWeekSlots } from './useWeek'
import { canDrag, dayLabel, durationOf, SNAP, weekDays, weekHours } from './weekModel'
import './week.css'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Slots = Schemas['SlotsView']

/**
 * Что сказать после переноса: удачно — тихо (status), отказ сервера — заметно (alert).
 * @param undo перенести обратно — на прежние день и время (перетащили случайно)
 */
type Notice = { tone: 'ok' | 'error'; text: string; undo?: Move }

/**
 * «Неделя» на компьютере: семь дней одного врача колонками (пн–вс) по его рабочим часам. Нажать на
 * приём — его карточка; на пустое место — «Новая запись» на этот день и время; заголовок дня — «День».
 * Приём впереди можно перетащить мышью на другой день и время (шаг 15 минут) — без подтверждения,
 * но решает сервер: занято — блок вернётся на место с ответом сервера. С клавиатуры — «Перенести» в карточке.
 */
export function WeekGrid({ me, doctorId, monday, today, selectedId, onOpen, onNew, onOpenDay }: {
  me: Me
  doctorId: number
  /** Понедельник недели 'YYYY-MM-DD'. */
  monday: string
  today: string
  selectedId?: number
  onOpen: (a: Appointment) => void
  onNew: (date: string, minutes: number) => void
  onOpenDay: (date: string) => void
}) {
  const days = weekDays(monday)
  const week = useWeekAppointments(monday, doctorId)
  const slots = useWeekSlots(monday, doctorId).map((q) => q.data)
  const list = (week.data ?? []).filter((a) => a.status !== 'CANCELLED')
  const { from, to } = weekHours(slots, list, me.clinic)
  const height = (to - from) * PX + PAD * 2
  const y = (minutes: number) => PAD + (Math.min(Math.max(minutes, from), to) - from) * PX
  const nowMinutes = useNowMinutes()
  const editable = canEditDoctor(me, doctorId)

  const grid = useRef<HTMLDivElement>(null)
  const columns = useRef<(HTMLElement | null)[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const move = useMove(monday, doctorId)
  const { ghost, handlers, consumeDrag } = useDrag({
    days, from, to, columns, scroller: grid,
    onDrop: (m) => {
      setNotice(null)
      // Откуда тащили — чтобы «Вернуть как было» одним нажатием, если перетащили случайно
      const was = m.appointment.startAt!
      move.mutate(m, {
        onSuccess: (a) => setNotice({
          tone: 'ok',
          text: `Перенесено: ${dayTitle(m.date)}, ${timeOf(a.startAt!)} (было: ${dayTitle(dateOf(was))}, ${timeOf(was)}) — напомните пациенту заново`,
          undo: { appointment: a, date: dateOf(was), minutes: minutesOf(was) },
        }),
        onError: (e) => setNotice({ tone: 'error', text: `Не перенесли: ${e.message}` }),
      })
    },
  })

  // Сетка — до низа окна, как у «Дня»; открыли неделю — к «сейчас» или к первому приёму (один раз на неделю)
  useEffect(() => {
    const el = grid.current
    if (el) el.style.setProperty('--grid-top', `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`)
  })
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (week.isPending || !grid.current || scrolledFor.current === monday) return
    scrolledFor.current = monday
    const first = list.length ? Math.min(...list.map((a) => minutesOf(a.startAt!))) : null
    const target = days.includes(today) ? nowMinutes : first
    if (target != null) grid.current.scrollTop = Math.max(0, y(target) - 80)
  })

  /** Пустое место в колонке → «Новая запись» на это время, вниз до 15 минут. */
  const pick = (date: string) => (e: MouseEvent<HTMLDivElement>) => {
    if (!editable || (e.target as HTMLElement).closest('.appt, .grid-free')) return
    const minutes = from + Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top - PAD) / PX / SNAP) * SNAP
    onNew(date, Math.min(Math.max(minutes, from), to - SNAP))
  }

  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from + i * 60)
  const showNow = days.includes(today) && nowMinutes >= from && nowMinutes <= to

  return (
    <div className="week">
      {/* Что здесь можно делать — словами (чья неделя и сколько записей — в шапке над чипами) */}
      <p className="week-caption hint">
        Неделя одного врача. Нажмите на день — откроется весь день{editable ? '; на свободное время — новая запись; приём можно перетащить мышью на другое время' : ' (только просмотр)'}
      </p>
      {notice && (
        <p className={`week-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
          {notice.undo && (
            <button type="button" className="link week-undo" disabled={move.isPending} onClick={() => {
              const back = notice.undo!
              setNotice(null)
              move.mutate(back, {
                onSuccess: (a) => setNotice({ tone: 'ok', text: `Вернули как было: ${dayTitle(back.date)}, ${timeOf(a.startAt!)}` }),
                onError: (e) => setNotice({ tone: 'error', text: `Не вернули: ${e.message}` }),
              })
            }}>↩ Вернуть как было</button>
          )}
        </p>
      )}
      {week.error && <p className="error" role="alert">{week.error.message}</p>}
      <div ref={grid} className={`grid week-grid${ghost ? ' dragging' : ''}`}
        style={{ gridTemplateColumns: '56px repeat(7, minmax(104px, 1fr))' } as CSSProperties}>
        <div className="grid-corner" />
        {days.map((date, i) => {
          const { weekday, day } = dayLabel(date)
          const count = list.filter((a) => a.startAt && dateOf(a.startAt) === date).length
          return (
            <button key={date} type="button" className={`grid-head week-head${date === today ? ' today' : ''}${isOff(slots[i]) ? ' off' : ''}`}
              aria-label={`${dayTitle(date)}: открыть день`} onClick={() => onOpenDay(date)}>
              <span className="week-head-day">{weekday} <b className="num">{day}</b></span>
              <span className="week-head-count hint">{count ? `${count} зап.` : isOff(slots[i]) ? 'выходной' : 'нет записей'}</span>
            </button>
          )
        })}
        <div className="grid-times" style={{ height }}>
          {hours.filter((m) => !showNow || Math.abs(m - nowMinutes) > 15).map((m) => (
            <span key={m} className="num" style={{ top: y(m) }}>{hhmm(m)}</span>
          ))}
          {showNow && <span className="now-label num" style={{ top: y(nowMinutes) }}>{hhmm(nowMinutes)}</span>}
        </div>
        {days.map((date, i) => {
          const sl = slots[i]
          const own = list.filter((a) => a.startAt && dateOf(a.startAt) === date)
          const past = date < today ? height : date === today && showNow ? y(nowMinutes) : 0
          return (
            <div key={date} ref={(el) => { columns.current[i] = el }} role="group" aria-label={dayTitle(date)}
              className={`grid-col week-col${isOff(sl) ? ' off' : ''}`} style={{ height }} onClick={pick(date)}
              title={editable ? 'Нажмите на свободное время — новая запись' : 'Расписание коллеги — только просмотр'}>
              {hours.map((m) => <div key={m} className="grid-hour" style={{ top: y(m) }} />)}
              {past > 0 && <div className="grid-past" style={{ height: past }} />}
              <Hours slots={sl} from={from} to={to} height={height} y={y} />
              {editable && date >= today && sl?.workingDay && (sl.free ?? []).map((w) => {
                const start = Math.max(minutesOf(w.start!), date === today ? nowMinutes : 0, from)
                const end = Math.min(minutesOf(w.end!) || 24 * 60, to)
                if (end - start < 30) return null
                const text = `${hhmm(start)}–${hhmm(end)}`
                return (
                  <button key={w.start} type="button" className="grid-free week-free" style={{ top: y(start) + 2, height: (end - start) * PX - 4 }}
                    aria-label={`${dayTitle(date)}: свободно с ${text.replace('–', ' до ')}, записать`} onClick={() => onNew(date, Math.ceil(start / 5) * 5)}>
                    <span className="grid-free-text">Свободно <span className="num">{text}</span></span>
                  </button>
                )
              })}
              {date === today && showNow && <div className="grid-now" style={{ top: y(nowMinutes) }} />}
              {own.map((a) => (
                <Block key={a.id} a={a} me={me} y={y} selected={selectedId === a.id}
                  moving={ghost?.appointment.id === a.id || (move.isPending && move.variables?.appointment.id === a.id)}
                  drag={canDrag(a, me) ? handlers(a) : undefined}
                  onClick={() => { if (!consumeDrag()) onOpen(a) }} />
              ))}
              {ghost?.day === i && <GhostBlock ghost={ghost} y={y} />}
            </div>
          )
        })}
      </div>
      {week.isPending && <p className="hint">Загрузка недели…</p>}
    </div>
  )
}

function isOff(sl: Slots | undefined): boolean {
  return Boolean(sl && !sl.workingDay)
}

/** Нерабочее: выходной целиком, до начала и после конца рабочего дня, перерывы. */
function Hours({ slots: sl, from, to, height, y }: { slots: Slots | undefined; from: number; to: number; height: number; y: (m: number) => number }) {
  if (!sl) return null
  if (!sl.workingDay) {
    return <div className="grid-off" style={{ top: 0, height }}><span>{sl.dayOff ? `${sl.dayOff.emoji ?? ''} ${sl.dayOff.title ?? ''}` : 'Выходной'}</span></div>
  }
  const workFrom = sl.workStart ? minutesOfTime(sl.workStart) : null
  const workTo = sl.workEnd ? minutesOfTime(sl.workEnd) : null
  return (
    <>
      {workFrom != null && workFrom > from && <div className="grid-off" style={{ top: 0, height: y(workFrom) }} />}
      {workTo != null && workTo < to && <div className="grid-off" style={{ top: y(workTo), height: height - y(workTo) }} />}
      {(sl.breaks ?? []).map((b) => (
        <div key={b.start} className="grid-break" style={{ top: y(minutesOf(b.start!)), height: Math.max(y(minutesOf(b.end!)) - y(minutesOf(b.start!)), 14) }}
          title={`${timeOf(b.start!)}–${timeOf(b.end!)} ${b.title ?? ''}`}>
          <span>{b.emoji}</span>
        </div>
      ))}
    </>
  )
}

/** Ниже этой высоты блок недели — одной строкой (приём на 15 минут). */
const WEEK_SHORT = 40

/** Приём в колонке дня: заливка статуса, время и имя; можно тащить — курсор «рука». */
function Block({ a, me, y, selected, moving, drag, onClick }: {
  a: Appointment
  me: Me
  y: (m: number) => number
  selected: boolean
  moving: boolean
  drag?: ReturnType<ReturnType<typeof useDrag>['handlers']>
  onClick: () => void
}) {
  const s = statusOf(a)
  const start = minutesOf(a.startAt!)
  const h = Math.max(durationOf(a) * PX - 2, 22)
  // Колонка недели уже, чем у «Дня»: приём на 30 минут — время и имя в две строки, статус — от 45 минут
  const short = h < WEEK_SHORT
  const range = `${timeOf(a.startAt!)}–${timeOf(a.endAt!)}`
  return (
    <button type="button" {...drag} onClick={onClick}
      className={`appt s-${s.kind}${short ? ' short' : ''}${selected ? ' active' : ''}${drag ? ' can-drag' : ''}${moving ? ' moving' : ''}`}
      style={{ top: y(start), height: h }} aria-label={`${range}, ${a.patient?.fullName}: ${s.label}`}
      title={drag ? 'Перетащите мышью на другое время или день' : canEditPast(a, me) ? 'Прошедший приём не переносят' : undefined}>
      <span className="appt-time num">{short ? timeOf(a.startAt!) : range}</span>
      <span className="appt-name">{a.patient?.fullName}</span>
      {short && <span className="ico" aria-hidden="true">{s.icon}</span>}
      {h > 56 && <span className="appt-state"><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}</span>}
    </button>
  )
}

function canEditPast(a: Appointment, me: Me): boolean {
  return canEditDoctor(me, a.doctorId) && a.startAt != null && new Date(a.startAt) <= new Date()
}

/** Тень на месте, куда встанет приём: время словом; нельзя (прошлое) — красная рамка. */
function GhostBlock({ ghost, y }: { ghost: NonNullable<ReturnType<typeof useDrag>['ghost']>; y: (m: number) => number }) {
  const duration = durationOf(ghost.appointment)
  return (
    <div className={`week-ghost${ghost.allowed ? '' : ' blocked'}`} style={{ top: y(ghost.minutes), height: Math.max(duration * PX - 2, 22) }}
      aria-hidden="true">
      <span className="num">{hhmm(ghost.minutes)}–{hhmm(ghost.minutes + duration)}</span>
    </div>
  )
}
