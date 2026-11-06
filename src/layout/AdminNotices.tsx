import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { billingLine } from '../account/texts'
import { api, unwrap, type Schemas } from '../api/client'
import { openSettings } from '../lib/route'

type Me = Schemas['BookingViewsMe']

/**
 * Напоминания админу клиники над рабочей областью — только когда пора что-то делать:
 * оплата кончается (7 дней и меньше), отсрочка или пауза; вышел договор (адресованный клинике или назначенный ей), который она ещё не
 * подписала; «О клинике» не заполнено (пациенты не видят адреса, согласие без названия клиники).
 * Напоминание можно скрыть ✕ до конца сеанса (sessionStorage: только ключ напоминания, без личных
 * данных); новая версия договора или другой срок оплаты — новый ключ, напоминание вернётся.
 */
export function AdminNotices({ me }: { me: Me }) {
  const admin = Boolean(me.doctor && me.admin)
  const billing = useQuery({ queryKey: ['clinic-billing'], queryFn: () => unwrap(api.GET('/api/clinic/billing')), enabled: admin, staleTime: 10 * 60_000 })
  const agreement = useQuery({ queryKey: ['clinic-agreement'], queryFn: () => unwrap(api.GET('/api/clinic/agreement')), enabled: admin, staleTime: 10 * 60_000 })
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')), enabled: admin, staleTime: 10 * 60_000 })
  const [hidden, setHidden] = useState(readHidden)
  if (!admin) return null
  const line = billing.data ? billingLine(billing.data) : null
  const a = agreement.data
  const c = clinic.data
  const empty = c && (!c.legalName || (!c.address && !c.mapUrl && !c.supportUrl && !c.supportPhone))
  const notes: { key: string; tone: string; text: string; item: string }[] = []
  if (line && (line.tone === 'wait' || line.tone === 'bad')) {
    notes.push({ key: `billing:${line.tone}:${billing.data?.paidUntil ?? ''}`, tone: line.tone, text: `Приложение: ${line.text}. Продлить — «Настройки → Тариф и оплата».`, item: 'plan' })
  }
  if (a?.current && !a.accepted) {
    notes.push({ key: `agreement:${a.current.version}`, tone: 'wait', text: a.last ? `Договор с платформой обновился (версия ${a.current.version}) — прочитайте и подпишите.`
      : 'Договор с платформой — прочитайте и подпишите.', item: 'agreement' })
  }
  if (empty) {
    notes.push({ key: 'clinic', tone: 'wait', text: 'Заполните «О клинике»: название клиники или ИП (для согласия пациентов), адрес и техподдержку.', item: 'about' })
  }
  const shown = notes.filter((n) => !hidden.includes(n.key))
  if (!shown.length) return null
  const hide = (key: string) => {
    const next = [...hidden, key]
    setHidden(next)
    try {
      sessionStorage.setItem(HIDDEN, JSON.stringify(next))
    } catch {
      // приватный режим — скрыто до перезагрузки
    }
  }
  return (
    <div className="notices" role="status">
      {shown.map((n) => (
        <div key={n.key} className={`notice tone-${n.tone}`}>
          <span className="notice-ico" aria-hidden="true">{n.tone === 'bad' ? '!' : 'i'}</span>
          <button type="button" className="notice-text" onClick={() => openSettings(n.item)}>
            {n.text} <span className="notice-open" aria-hidden="true">Открыть ›</span>
          </button>
          <button type="button" className="notice-close" aria-label="Скрыть напоминание до конца сеанса" title="Скрыть до конца сеанса" onClick={() => hide(n.key)}>✕</button>
        </div>
      ))}
    </div>
  )
}

/** Скрытые напоминания этого сеанса (вкладки браузера). */
const HIDDEN = 'crm.notices.hidden'

function readHidden(): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(HIDDEN) ?? '[]')
    return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
