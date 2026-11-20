import { memo, type CSSProperties } from 'react'

import type { Schemas } from '../api/client'
import { timeOf } from '../lib/time'
import { TagDots } from '../tags/TagDots'
import { ApptBadges } from './ApptBadges'
import { MAX_BADGES, narrowAppt } from './badges'
import { colleagueTimeOf } from './chairTime'
import { PAD, PX, SHORT } from './gridScale'
import { isShaky } from './paint'
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
export const DayAppt = memo(function DayAppt({ a, date, from, limit, active, money, chairTime, hover, onOpen, onQuick, paint }: {
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
  /** Меню быстрых действий: правая кнопка мыши или «⋯» (у точки) — стабильная функция (useCallback) */
  onQuick?: (a: Appointment, at: { x: number; y: number }) => void
  /** «Красить по врачу / услуге» (schedule/paint.ts): цвет заливки вместо цвета статуса; статус остаётся словом */
  paint?: string
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
    <>
    <button type="button" className={`appt s-${s.kind}${short ? ' short' : ''}${active ? ' active' : ''}${carried ? ' carried' : ''}${continues ? ' continues' : ''}${isShaky(a) ? ' shaky' : ''}${paint ? ' painted' : ''}`}
      style={paint ? { top, height: h, '--paint': paint } as CSSProperties : { top, height: h }} {...hover(a)}
      onClick={() => onOpen(a.id)}
      onContextMenu={onQuick ? (e) => { e.preventDefault(); e.stopPropagation(); onQuick(a, { x: e.clientX, y: e.clientY }) } : undefined}
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
        <span className="appt-name"><TagDots patient={a.patient} />{a.patient.fullName}</span>
        <ApptBadges appointment={a} money={money} chair={colleagueTimeOf(a, chairTime)} max={narrowAppt(a) ? 1 : MAX_BADGES} />
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
    {/* «⋯» — меню быстрых действий: соседом блока (кнопка в кнопке недопустима), в правом нижнем углу; видна при
        наведении на запись и с клавиатуры, на сенсорном экране — всегда (crm.css) */}
    {onQuick && (
      <button type="button" className="appt-more" style={{ top: top + h - 24 }} aria-label="Быстрые действия с записью"
        title="Действия" onClick={(e) => {
          // Колонка сетки по нажатию открывает новую запись — до неё нажатие не доходит
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          onQuick(a, { x: r.left, y: r.bottom + 4 })
        }}>⋯</button>
    )}
    </>
  )
})
