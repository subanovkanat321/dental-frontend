import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { ApptHoverCard } from './ApptHoverCard'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Задержка до карточки: мышь, которая просто проходит над сеткой, не мигает карточками. */
const HOVER_DELAY = 300

type Shown = { a: Appointment; rect: DOMRect }

/**
 * Всплывающая карточка приёма при наведении мыши (компьютер): кто, телефон, врач, статус, услуга,
 * комментарий, предоплата и долг — не открывая карточку справа. Клик по приёму работает как раньше
 * (карточка справа), а всплывающая при нажатии прячется. Палец (pointerType touch/pen) — без неё:
 * на телефоне «наведения» нет, тап сразу открывает карточку. Esc и прокрутка прячут.
 *
 * Возвращает обработчики для блока приёма и сам элемент карточки (портал в body: сетка с
 * overflow: auto обрезала бы её по краю колонки).
 */
export function useApptHover(me: Me, doctorName: (id: number | undefined) => string) {
  const [shown, setShown] = useState<Shown | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setShown(null)
  }, [])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [shown, hide])
  useEffect(() => () => clearTimeout(timer.current), [])

  const bind = (a: Appointment) => ({
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') return
      const el = e.currentTarget
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setShown({ a, rect: el.getBoundingClientRect() }), HOVER_DELAY)
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    'aria-describedby': shown?.a.id === a.id ? id : undefined,
  })

  const card = shown
    ? createPortal(<ApptHoverCard id={id} a={shown.a} rect={shown.rect} me={me} doctor={doctorName(shown.a.doctorId)} />, document.body)
    : null
  return { bind, card, hide }
}
