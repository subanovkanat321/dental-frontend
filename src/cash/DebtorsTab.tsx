import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import type { Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { shortDate, somText } from '../lib/time'
import { debtorsOf, type FamilyOf } from './debtors'
import { Loading } from '../layout/Loading'

type Debt = Schemas['PaymentQueryDebt']

/**
 * «Касса → Должники»: кто сколько должен — по пациентам, с суммой, давностью и сроком «обещал
 * оплатить». Имя — в карточку пациента (там телефон, WhatsApp), приём — в карточку приёма с оплатой.
 */
export function DebtorsTab({ rows, pending, error, onOpen, onOpenPatient }: {
  rows: Debt[] | undefined
  pending: boolean
  error?: string
  onOpen: (appointmentId: number) => void
  onOpenPatient?: (patientId: number) => void
}) {
  const families = useQuery({ queryKey: ['families'], queryFn: () => unwrap(api.GET('/api/families')) })
  const [byFamily, setByFamily] = useState(true)
  const familyOf: FamilyOf = new Map()
  for (const f of families.data ?? []) for (const m of f.members ?? []) familyOf.set(m.id!, { id: f.id!, name: f.name ?? 'Семья' })
  const grouped = byFamily && familyOf.size > 0
  if (pending) return <section className="card-block"><Loading /></section>
  if (error) return <section className="card-block"><p className="error">{error}</p></section>
  const list = debtorsOf(rows ?? [], undefined, grouped ? familyOf : undefined)
  if (!list.length) return <section className="card-block"><EmptyState title="Должников нет">Все приёмы оплачены полностью.</EmptyState></section>
  const total = list.reduce((s, x) => s + x.total, 0)
  const overdue = list.filter((x) => x.overdue)
  return (
    <section className="card-block debtors" aria-label="Должники">
      <div className="block-head">
        <h2>Должники</h2>
        {familyOf.size > 0 && (
          <label className="check"><input type="checkbox" checked={byFamily} onChange={(e) => setByFamily(e.target.checked)} /> Семьи вместе</label>
        )}
      </div>
      <div className="debtors-sum">
        <div><span className="hint">Должны всего</span><b className="num">{somText(total)}</b></div>
        <div><span className="hint">Пациентов</span><b className="num">{list.length}</b></div>
        <div className={overdue.length ? 'tone-bad' : undefined}><span className="hint">Просрочили</span>
          <b className="num">{overdue.length ? `${overdue.length} · ${somText(overdue.reduce((s, x) => s + x.total, 0))}` : 0}</b></div>
      </div>
      <ul className="debtors-list">
        {list.map((x) => (
          <li key={x.key} className={x.overdue ? 'overdue' : undefined}>
            <div className="debtor-head">
              {x.patientId != null && onOpenPatient
                ? <button type="button" className="row-link" onClick={() => onOpenPatient(x.patientId!)}>{x.patient}</button>
                : <strong>{x.patient}</strong>}
              <b className="num">{somText(x.total)}</b>
            </div>
            <p className="hint">
              {x.visits.length === 1 ? '1 приём' : `приёмов: ${x.visits.length}`} · с {shortDate(x.since)}
              {x.due && <span className={x.overdue ? 'tone-bad' : undefined}> · {x.overdue ? 'обещал оплатить до' : 'оплатит до'} {shortDate(`${x.due}T12:00:00Z`)}</span>}
            </p>
            <div className="debtor-visits">
              {x.visits.map((v) => (
                <button key={v.appointmentId} type="button" className="chip" onClick={() => onOpen(v.appointmentId!)}>
                  {shortDate(v.startAt!)}{v.service ? ` · ${v.service}` : ''} · {somText(v.debtSom ?? 0)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
