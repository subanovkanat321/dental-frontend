import { useState } from 'react'

import type { Schemas } from '../api/client'
import { inTelegram } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { useLabOrders, useOrderStatus, useSaveOrder, type LabOrder } from './api'
import { LabOrderDialog } from './LabOrderDialog'
import { STATUS, technicianPhone, technicianText, waiting } from './text'
import './lab.css'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

/**
 * Работы лаборатории в карточке приёма. Назначена примерка на этот приём — «🦷 Коронка 36 — Готово»; работа ещё у
 * техника — предупреждение «ещё не пришла» с «💬 WhatsApp технику» (письмо с именем пациента собирает браузер) и
 * «Пришла». Приём впереди, а у пациента есть работа без примерки — «назначить примеркой на этот приём». Остальные
 * работы пациента у техника (2026-11-21, владелец: «из карточки приёма в лабораторию не перейти») — строками; нажатие
 * на работу открывает её заказ (статус, срок, примерка).
 */
export function AppointmentLab({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const [opened, setOpened] = useState<LabOrder | null>(null)
  const list = useLabOrders({ patientId: a.patient.id }, a.patient.id > 0)
  const status = useOrderStatus()
  const save = useSaveOrder()
  const orders = list.data ?? []
  const here = orders.filter((o) => o.fittingAppointmentId === a.id)
  const upcoming = (a.status === 'SCHEDULED' || a.status === 'REQUESTED') && a.startAt > new Date().toISOString()
  const unassigned = upcoming ? orders.filter((o) => o.status !== 'FITTED' && o.fittingAppointmentId == null) : []
  const others = orders.filter((o) => o.status !== 'FITTED' && o.fittingAppointmentId !== a.id && !unassigned.includes(o))
  if (!here.length && !unassigned.length && !others.length) return null
  const work = (o: LabOrder) => (
    <button type="button" className="link appt-lab-open" onClick={() => setOpened(o)} aria-label={`Открыть заказ: ${o.work}`}>{o.work}</button>
  )
  const attach = (o: LabOrder) => save.mutate({
    id: o.id,
    body: {
      patientId: o.patientId, doctorId: o.doctorId, labId: o.labId, kind: o.kind, kindNote: o.kindNote, teeth: o.teeth, sentOn: o.sentOn,
      dueOn: o.dueOn, fittingAppointmentId: a.id, priceSom: o.canMoney ? o.priceSom : undefined, note: o.note,
    },
  })
  return (
    <section className="appt-lab" aria-label="Лаборатория на этот приём">
      {here.map((o) => {
        const phone = technicianPhone(o)
        const late = waiting(o)
        return (
          <div key={o.id} className={late ? 'appt-lab-item late' : 'appt-lab-item'}>
            <p className="appt-lab-line">🦷 <strong>{work(o)}</strong> — {STATUS[o.status]}</p>
            {late && (
              <>
                <p className="appt-lab-warn" role="alert">
                  Работа ещё не пришла из «{o.labName}»{o.overdue ? ' — срок прошёл' : ''}. Позвоните технику.
                </p>
                <p className="row appt-lab-actions">
                  {phone && (
                    <a className="btn small" href={whatsappUrl(phone, technicianText(o))} target="_blank" rel="noopener noreferrer"
                      onClick={inTelegram(whatsappUrl(phone, technicianText(o)))}>💬 WhatsApp технику</a>
                  )}
                  {o.labPhone && <a className="btn small" href={`tel:+${o.labPhone}`} onClick={inTelegram(`tel:+${o.labPhone}`)}>Позвонить</a>}
                  <button type="button" className="btn small" disabled={status.isPending} onClick={() => status.mutate({ id: o.id, status: 'READY' })}>Пришла</button>
                </p>
              </>
            )}
          </div>
        )
      })}
      {unassigned.map((o) => (
        <p key={o.id} className="appt-lab-line hint">
          🦷 {work(o)} ({STATUS[o.status].toLowerCase()}) — примерка не записана.{' '}
          <button type="button" className="link" disabled={save.isPending} onClick={() => attach(o)}>Примерка на этот приём</button>
        </p>
      ))}
      {others.map((o) => (
        <p key={o.id} className="appt-lab-line hint">🦷 {work(o)} — {STATUS[o.status].toLowerCase()}{o.dueOn ? ` · срок ${o.dueOn.slice(8, 10)}.${o.dueOn.slice(5, 7)}` : ''}</p>
      ))}
      {(status.error ?? save.error) && <p className="error" role="alert">{(status.error ?? save.error)!.message}</p>}
      {opened && <LabOrderDialog me={me} order={opened} onClose={() => setOpened(null)} onSaved={() => setOpened(null)} />}
    </section>
  )
}
