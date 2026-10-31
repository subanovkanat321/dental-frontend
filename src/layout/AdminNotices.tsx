import { useQuery } from '@tanstack/react-query'

import { billingLine } from '../account/texts'
import { api, unwrap, type Schemas } from '../api/client'
import { openSettings } from '../lib/route'

type Me = Schemas['BookingViewsMe']

/**
 * Напоминания админу клиники над рабочей областью — только когда пора что-то делать:
 * оплата кончается (7 дней и меньше), отсрочка или пауза; вышел договор, который клиника ещё не
 * подписала; «О клинике» не заполнено (пациенты не видят адреса, согласие без названия клиники).
 */
export function AdminNotices({ me }: { me: Me }) {
  const admin = Boolean(me.doctor && me.admin)
  const billing = useQuery({ queryKey: ['clinic-billing'], queryFn: () => unwrap(api.GET('/api/clinic/billing')), enabled: admin, staleTime: 10 * 60_000 })
  const agreement = useQuery({ queryKey: ['clinic-agreement'], queryFn: () => unwrap(api.GET('/api/clinic/agreement')), enabled: admin, staleTime: 10 * 60_000 })
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: admin, staleTime: 10 * 60_000 })
  if (!admin) return null
  const line = billing.data ? billingLine(billing.data) : null
  const a = agreement.data
  const c = clinic.data
  const empty = c && (!c.legalName || (!c.address && !c.mapUrl && !c.supportUrl && !c.supportPhone))
  const notes: { key: string; tone: string; text: string; item: string }[] = []
  if (line && (line.tone === 'wait' || line.tone === 'bad')) {
    notes.push({ key: 'billing', tone: line.tone, text: `Приложение: ${line.text}. Продлить — «Настройки → Тариф и оплата».`, item: 'plan' })
  }
  if (a?.current && !a.accepted) {
    notes.push({ key: 'agreement', tone: 'wait', text: a.last ? `Договор с платформой обновился (версия ${a.current.version}) — прочитайте и подпишите.`
      : 'Договор с платформой — прочитайте и подпишите.', item: 'agreement' })
  }
  if (empty) {
    notes.push({ key: 'clinic', tone: 'wait', text: 'Заполните «О клинике»: название клиники или ИП (для согласия пациентов), адрес и техподдержку.', item: 'about' })
  }
  if (!notes.length) return null
  return (
    <div className="notices" role="status">
      {notes.map((n) => (
        <button key={n.key} type="button" className={`notice tone-${n.tone}`} onClick={() => openSettings(n.item)}>{n.text}</button>
      ))}
    </div>
  )
}
