import { useCallback, useEffect, useId, useState, type PointerEvent } from 'react'

import type { Schemas } from '../api/client'
import { ApptHoverLayer } from './ApptHoverLayer'
import { createHoverStore } from './hoverStore'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/**
 * Всплывающая карточка приёма при наведении мыши (компьютер): кто, телефон, врач, статус, услуга,
 * комментарий, предоплата и долг — не открывая карточку справа. Клик по приёму работает как раньше
 * (карточка справа), а всплывающая при нажатии прячется. Палец (pointerType touch/pen) — без неё:
 * на телефоне «наведения» нет, тап сразу открывает карточку. Esc и прокрутка прячут.
 *
 * Возвращает обработчики для блока приёма и сам элемент карточки (портал в body: сетка с
 * overflow: auto обрезала бы её по краю колонки). Состояние наведения живёт в своём хранилище и в
 * компоненте карточки — страница с сеткой от наведения не перерисовывается.
 */
export function useApptHover(me: Me, doctorName: (id: number | undefined) => string) {
  const [store] = useState(createHoverStore)
  const id = useId()
  useEffect(() => () => store.hide(), [store])

  // Стабильная функция (хранилище одно на сетку): блок приёма в memo не перерисовывается из-за неё
  const bind = useCallback((a: Appointment) => ({
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') return
      store.showLater(a, e.currentTarget)
    },
    onPointerLeave: store.hide,
    onPointerDown: store.hide,
  }), [store])

  const card = <ApptHoverLayer store={store} id={id} me={me} doctorName={doctorName} />
  return { bind, card, hide: store.hide }
}
