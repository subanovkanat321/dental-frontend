import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'

type Debt = Schemas['PaymentQueryDebt']

export type Debtor = { key: string; patientId?: number; patient: string; total: number; visits: Debt[]; since: string; overdue: boolean; due?: string }

/** Долги по приёмам → по пациентам: кто сколько должен, с какого числа, просрочено ли. Больше долг — выше. */
/** Семьи клиники: пациент → его семья (название, номер) — чтобы сложить долги по семьям. */
export type FamilyOf = Map<number, { id: number; name: string }>

export function debtorsOf(rows: Debt[], today = todayIn(), families?: FamilyOf): Debtor[] {
  const map = new Map<string, Debtor>()
  for (const d of rows) {
    if (!d.debtSom) continue
    const family = d.patientId != null ? families?.get(d.patientId) : undefined
    const key = family ? `f${family.id}` : String(d.patientId ?? d.patient)
    const x = map.get(key) ?? {
      key, patientId: d.patientId, patient: family ? `👨‍👩‍👧 ${family.name}` : d.patient ?? '—', total: 0, visits: [], since: d.startAt ?? '', overdue: false,
    }
    x.total += d.debtSom
    x.visits.push(d)
    if (d.startAt && (!x.since || d.startAt < x.since)) x.since = d.startAt
    if (d.dueOn && d.dueOn < today) x.overdue = true
    if (d.dueOn && (!x.due || d.dueOn < x.due)) x.due = d.dueOn
    map.set(key, x)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

