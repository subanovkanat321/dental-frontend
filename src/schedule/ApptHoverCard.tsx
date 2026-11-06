import { useLayoutEffect, useRef, useState } from 'react'

import type { Schemas } from '../api/client'
import { contactPhone } from '../lib/guardian'
import { seesMoneyOf } from '../lib/roles'
import { dateOf, dayTitle, formatPhone, somText, timeOf } from '../lib/time'
import { statusOf } from './status'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/**
 * Содержимое всплывающей карточки приёма (useApptHover): время и день, статус чипом, пациент,
 * телефон (как в карточке справа — номер представителя, если он есть), врач, услуга, комментарий;
 * предоплата и долг — только тем, кто видит деньги этого врача (seesMoneyOf).
 */
export function ApptHoverCard({ id, a, rect, me, doctor }: { id: string; a: Appointment; rect: DOMRect; me: Me; doctor: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // Справа от блока; не влезает — слева; по высоте — не ниже края окна
  const [pos, setPos] = useState({ left: rect.right + 8, top: rect.top })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = rect.right + 8 + w <= window.innerWidth - 8 ? rect.right + 8 : Math.max(8, rect.left - 8 - w)
    const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - h - 8))
    setPos({ left, top })
  }, [rect])

  const s = statusOf(a)
  const phone = contactPhone(a.patient)
  const money = seesMoneyOf(me, a.doctorId)
  const deposit = money && a.depositStatus && ['REQUESTED', 'SCHEDULED'].includes(a.status ?? '')
    ? `${a.depositSom ? somText(a.depositSom) : ''} ${a.depositStatus === 'RECEIVED' ? 'получена' : a.depositStatus === 'REPORTED' ? '— проверьте' : '— ждём'}`.trim()
    : null
  const rows: [string, string | null | undefined][] = [
    ['Пациент', a.patient?.fullName],
    ['Телефон', phone ? formatPhone(phone) : null],
    ['Врач', doctor],
    ['Услуга', a.serviceName],
    ['Комментарий', a.comment?.trim()],
    ['Предоплата', deposit],
    ['Долг', money && (a.debtSom ?? 0) > 0 ? somText(a.debtSom!) : null],
  ]
  return (
    <div ref={ref} id={id} role="tooltip" className={`appt-hover s-${s.kind}`} style={{ left: pos.left, top: pos.top }}>
      <div className="appt-hover-head">
        <span className="num">{timeOf(a.startAt!)}–{timeOf(a.endAt!)}</span>
        <span className="hint">{dayTitle(dateOf(a.startAt!))}</span>
      </div>
      <span className={`appt-hover-status chip s-${s.kind}`}><span aria-hidden="true">{s.icon}</span> {s.label}</span>
      <dl>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className={k === 'Телефон' || k === 'Долг' ? 'num' : undefined}>{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}
