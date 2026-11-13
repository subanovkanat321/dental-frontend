import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

import type { Schemas } from '../../api/client'
import { minutesOf, slotInstant } from '../../lib/time'
import { PAD, PX } from '../gridScale'
import { DAY } from '../workSpans'
import { durationOf, SNAP, snapInto } from './weekModel'

type Appointment = Schemas['AppointmentView']

/** Куда встанет приём, если отпустить сейчас: день (номер колонки), минуты; allowed — сервер это примет по смыслу. */
export type Ghost = { appointment: Appointment; day: number; minutes: number; allowed: boolean }

type Press = { appointment: Appointment; pointerId: number; x: number; y: number; grab: number; dragging: boolean }

/** Сдвиг мыши до начала перетаскивания: меньше — это просто нажатие (открыть карточку). */
const THRESHOLD = 5

/** У края сетки она сама прокручивается — можно тащить на время, которого не видно. */
const EDGE = 40

/**
 * Перетаскивание приёмов мышью и пером — своё, на Pointer Events, без библиотеки: нужно немного —
 * колонка под курсором, шаг 15 минут, тень на новом месте. Нажатие без сдвига остаётся нажатием
 * (карточка приёма), палец (touch) не тащит — им прокручивают. Esc — отменить.
 * <p>
 * Колонки дней — {@code columns} (по порядку), прокрутка — {@code scroller}. Где колонка, узнаём
 * через getBoundingClientRect в момент движения: сетка могла прокрутиться.
 */
export function useDrag({ days, from, to, columns, scroller, onDrop }: {
  days: string[]
  from: number
  to: number
  columns: RefObject<(HTMLElement | null)[]>
  scroller: RefObject<HTMLElement | null>
  onDrop: (move: { appointment: Appointment; date: string; minutes: number }) => void
}) {
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const press = useRef<Press | null>(null)
  // Отпустили после перетаскивания — следующий click по блоку не открывает карточку
  const dragged = useRef(false)

  /** Колонка и минуты под курсором (без учёта, за какое место блока взялись). */
  const pointAt = (x: number, y: number): { day: number; minutes: number } | null => {
    const rects = (columns.current ?? []).map((c) => c?.getBoundingClientRect())
    if (!rects.length || rects.some((r) => !r)) return null
    let day = rects.findIndex((r) => x >= r!.left && x < r!.right)
    if (day < 0) day = x < rects[0]!.left ? 0 : rects.length - 1
    return { day, minutes: from + (y - rects[day]!.top - PAD) / PX }
  }

  const ghostAt = (p: Press, x: number, y: number): Ghost | null => {
    const point = pointAt(x, y)
    if (!point) return null
    // Начало — в своём дне: в продлённой после полуночи части сетки тащат только хвост приёма
    const minutes = Math.min(snapInto(point.minutes - p.grab, durationOf(p.appointment), from, to), DAY - SNAP)
    const date = days[point.day]!
    const same = slotInstant(date, minutes) === new Date(p.appointment.startAt).toISOString()
    return { appointment: p.appointment, day: point.day, minutes, allowed: !same && new Date(slotInstant(date, minutes)) > new Date() }
  }

  const cancel = () => {
    press.current = null
    setGhost(null)
  }

  // Esc во время перетаскивания — приём остаётся где был
  useEffect(() => {
    if (!ghost) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { dragged.current = true; cancel() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ghost])

  const handlers = (a: Appointment) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === 'touch') return
      const point = pointAt(e.clientX, e.clientY)
      press.current = {
        appointment: a, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dragging: false,
        // За какое место блока взялись: середину приёма тащим за середину, а не за верх
        grab: point ? point.minutes - minutesOf(a.startAt) : 0,
      }
      // Все движения — этому блоку, даже когда курсор ушёл в соседний день
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return
      p.dragging = true
      setGhost(ghostAt(p, e.clientX, e.clientY))
      const box = scroller.current?.getBoundingClientRect()
      if (scroller.current && box && box.height > 0) {
        if (e.clientY < box.top + EDGE) scroller.current.scrollTop -= 12
        else if (e.clientY > box.bottom - EDGE) scroller.current.scrollTop += 12
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      press.current = null
      if (!p.dragging) return
      dragged.current = true
      const target = ghostAt(p, e.clientX, e.clientY)
      setGhost(null)
      if (target?.allowed) onDrop({ appointment: p.appointment, date: days[target.day]!, minutes: target.minutes })
    },
    onPointerCancel: cancel,
  })

  /** Для onClick блока: true — это был конец перетаскивания, а не нажатие. */
  const consumeDrag = (): boolean => {
    const was = dragged.current
    dragged.current = false
    return was
  }

  return { ghost, handlers, consumeDrag }
}
