import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { Schemas } from '../api/client'
import { canEditDoctor } from '../lib/roles'
import { dateOf, minutesOf, timeOf } from '../lib/time'
import { useDrag } from './week/useDrag'
import { useDayMove, type DayMove } from './useDayMove'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Что сказать после переноса: удачно — тихо, с «Вернуть как было»; отказ сервера — заметно (alert). */
type Notice = { tone: 'ok' | 'error'; text: string; undo?: DayMove; date?: string }

export type DragBind = ReturnType<ReturnType<typeof useDrag>['handlers']>

/**
 * Перетаскивание в сетке «Дня» (компьютер, мышь и перо): тот же useDrag, что в «Неделе», — шаг 15 минут,
 * Esc отменяет, палец не тащит. Колонки — врачи на экране: в своей колонке — другое время (/reschedule),
 * в колонке коллеги («Все врачи») — передать ему (/transfer), только если его расписание мне можно менять.
 * <p>
 * {@code bind} и {@code consume} — стабильные функции: блоки дня (DayAppt) под memo и не перерисовываются
 * из-за каждого движения мыши; состояние нажатия у useDrag в ref, поэтому обращение через ref безопасно.
 */
export function useDayDrag({ me, date, doctors, from, to, columns, scroller }: {
  me: Me
  date: string
  /** Врачи колонками по порядку */
  doctors: { id: number; fullName?: string }[]
  from: number
  to: number
  columns: RefObject<(HTMLElement | null)[]>
  scroller: RefObject<HTMLElement | null>
}) {
  const [current, setNotice] = useState<Notice | null>(null)
  // Ушли на другой день — ответ о переносе прошлого дня больше не показываем
  const notice = current && current.date === date ? current : null
  const move = useDayMove(date)
  const nameOf = (id: number) => doctors.find((d) => d.id === id)?.fullName ?? 'другой врач'

  const run = (m: DayMove, back: boolean) => {
    setNotice(null)
    const was = m.appointment
    const show = (n: Notice) => setNotice({ ...n, date })
    move.mutate(m, {
      onSuccess: (a) => show(back
        ? { tone: 'ok', text: `Вернули как было: ${timeOf(a.startAt)}${a.doctorId !== was.doctorId ? `, ${nameOf(a.doctorId)}` : ''}` }
        : {
          tone: 'ok',
          text: a.doctorId !== was.doctorId
            ? `Передано: ${nameOf(a.doctorId)}, ${timeOf(a.startAt)} (было: ${nameOf(was.doctorId)}, ${timeOf(was.startAt)}) — напомните пациенту заново`
            : `Перенесено на ${timeOf(a.startAt)} (было: ${timeOf(was.startAt)}) — напомните пациенту заново`,
          undo: { appointment: a, date: dateOf(was.startAt), minutes: minutesOf(was.startAt), doctorId: was.doctorId },
        }),
      onError: (e) => show({ tone: 'error', text: `${back ? 'Не вернули' : 'Не перенесли'}: ${e.message}` }),
    })
  }

  // Колонок могло стать меньше (скрыли врача) — в массиве ref остаются пустые места за концом: берём только нужные
  const count = doctors.length
  const shownColumns = useMemo(() => ({ get current() { return (columns.current ?? []).slice(0, count) } }), [columns, count])
  const drag = useDrag({
    days: doctors.map(() => date), from, to, columns: shownColumns, scroller,
    columnOf: (a) => doctors.findIndex((d) => d.id === a.doctorId),
    accepts: (_a, column) => doctors[column] != null && canEditDoctor(me, doctors[column]!.id),
    onDrop: ({ appointment, date: day, minutes, column }) => run({ appointment, date: day, minutes, doctorId: doctors[column]!.id }, false),
  })

  const latest = useRef(drag)
  useLayoutEffect(() => { latest.current = drag })
  const bind = useCallback((a: Appointment): DragBind => ({
    onPointerDown: (e) => latest.current.handlers(a).onPointerDown(e),
    onPointerMove: (e) => latest.current.handlers(a).onPointerMove(e),
    onPointerUp: (e) => latest.current.handlers(a).onPointerUp(e),
    onPointerCancel: () => latest.current.handlers(a).onPointerCancel(),
  }), [])
  const consume = useCallback(() => latest.current.consumeDrag(), [])

  const movingId = drag.ghost?.appointment.id ?? (move.isPending ? move.variables?.appointment.id : undefined)
  const noticeView = notice && (
    <p className={`week-notice day-drag-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.text}
      {notice.undo && (
        <button type="button" className="link week-undo" disabled={move.isPending} onClick={() => run(notice.undo!, true)}>↩ Вернуть как было</button>
      )}
      <button type="button" className="link day-drag-close" aria-label="Скрыть" onClick={() => setNotice(null)}>✕</button>
    </p>
  )
  return { ghost: drag.ghost, bind, consume, movingId, notice: noticeView }
}
