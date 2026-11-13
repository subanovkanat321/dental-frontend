import { memo } from 'react'

import type { Schemas } from '../api/client'
import { timeOf } from '../lib/time'
import { ApptBadges } from './ApptBadges'
import { colleagueTimeOf } from './chairTime'
import { PAD, PX, SHORT } from './gridScale'
import { statusOf } from './status'
import type { useApptHover } from './useApptHover'
import { apptSpan, fromYesterday, untilTomorrow } from './workSpans'

type Appointment = Schemas['AppointmentView']

/**
 * Блок приёма в сетке «Дня». memo: сетка перерисовывается часто (линия «сейчас» раз в минуту,
 * автообновление, открытие карточки), а блок — только когда поменялся его приём (React Query
 * сохраняет тот же объект, если приём не изменился), выбор или раскладка. Все props — значения или
 * стабильные функции (onOpen — useCallback, hover — из хранилища наведения).
 */
export const DayAppt = memo(function DayAppt({ a, date, from, limit, active, money, chairTime, hover, onOpen }: {
  a: Appointment
  date: string
  /** Минута, с которой начинается сетка. */
  from: number
  /** Докуда видно приём в этом дне: 1440 — полночь, больше — сетка продлена после полуночи (gridRange). */
  limit: number
  active: boolean
  /** Видит ли сотрудник деньги этого врача (предоплата). */
  money: boolean
  chairTime: Schemas['SlotsViewChairTime'][] | undefined
  hover: ReturnType<typeof useApptHover>['bind']
  onOpen: (id: number) => void
}) {
  const s = statusOf(a)
  // Через полночь: в своём дне — целиком (сетка продлена после 24:00) или, если сетка и так на сутки
  // (ночная смена), до 24:00 с подписью «→ до 00:45»; на следующий день — с 00:00 и пометкой «со вчера»
  const [startMin, endMin] = apptSpan(a, date, limit)
  const carried = fromYesterday(a, date)
  const continues = untilTomorrow(a, date, limit)
  const top = PAD + (startMin - from) * PX
  // Обрезанный кусок — не ниже строки текста (24 px): время, имя и значки одной строкой без наложений
  const h = Math.max((endMin - startMin) * PX - 2, carried || continues ? 24 : 22)
  const short = h < SHORT
  return (
    <button type="button" className={`appt s-${s.kind}${short ? ' short' : ''}${active ? ' active' : ''}${carried ? ' carried' : ''}${continues ? ' continues' : ''}`}
      style={{ top, height: h }} {...hover(a)}
      onClick={() => onOpen(a.id)}
      aria-label={`${carried ? 'со вчера ' : ''}${timeOf(a.startAt)}–${timeOf(a.endAt)}, ${a.patient.fullName}: ${s.label}`}>
      {/* Обёртка — для широкого блока (один врач на экране): там она сеткой «время | имя и услуга | значки и статус»
          (container query в crm.css). В узком блоке она display: contents — раскладка прежняя.
          «wide-only» — то, что узкому блоку по высоте не влезает, а широкому влезает в ту же строку. */}
      <span className="appt-body">
        <span className="appt-time num">
          <span className="appt-from">{carried && <span className="appt-carried">со вчера </span>}{timeOf(a.startAt)}</span>
          {continues
            ? <span className="appt-until appt-cut">→ до {timeOf(a.endAt)}</span>
            : <span className={`appt-until${short ? ' wide-only' : ''}`}>–{timeOf(a.endAt)}</span>}
        </span>
        <span className="appt-name">{a.patient.fullName}</span>
        <ApptBadges appointment={a} money={money} chair={colleagueTimeOf(a, chairTime)} />
        {/* Статус словом и у короткого приёма: цвет без слова не читается (FINDING-002) */}
        <span className={`appt-state${short || h > 56 ? '' : ' wide-only'}`}><span className="ico" aria-hidden="true">{s.icon}</span> {s.label}</span>
        <span className="appt-sub">
          {a.serviceName && <span className={`appt-note${!short && h > 66 ? '' : ' wide-only'}`}>{a.serviceName}</span>}
          {a.comment && <span className={`appt-note${!short && h > 88 ? '' : ' wide-only'}`}>{a.comment}</span>}
          {a.depositStatus && money && ['REQUESTED', 'SCHEDULED'].includes(a.status) && (
            <span className={`appt-note${!short && h > 80 ? '' : ' wide-only'}`}>Предоплата {a.depositStatus === 'RECEIVED' ? 'получена' : a.depositStatus === 'REPORTED' ? '— проверьте' : '— ждём'}</span>
          )}
        </span>
      </span>
    </button>
  )
})
