import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'

type Debt = Schemas['PaymentQueryDebt']

/**
 * Должник: пациент или семья. `since` — первый неоплаченный визит (давность), `last` и `lastDoctor` —
 * последний визит в долг (для серой строки), `due` — ближайшее «обещал оплатить до».
 */
export type Debtor = {
  key: string; patientId?: number; patient: string; total: number; visits: Debt[]
  since: string; last: string; lastDoctor?: string; overdue: boolean; due?: string
}

/** Семьи клиники: пациент → его семья (название, номер) — чтобы сложить долги по семьям. */
export type FamilyOf = Map<number, { id: number; name: string }>

/** Порядок списка: больший долг выше или давний выше. */
export type DebtorSort = 'sum' | 'age'

/** Долги по приёмам → по пациентам (или семьям): кто сколько должен, с какого числа, просрочено ли. Больше долг — выше. */
export function debtorsOf(rows: Debt[], today = todayIn(), families?: FamilyOf): Debtor[] {
  const map = new Map<string, Debtor>()
  for (const d of rows) {
    if (!d.debtSom) continue
    const family = d.patientId != null ? families?.get(d.patientId) : undefined
    const key = family ? `f${family.id}` : String(d.patientId ?? d.patient)
    const x = map.get(key) ?? {
      key, patientId: d.patientId, patient: family ? `👨‍👩‍👧 ${family.name}` : d.patient ?? '—', total: 0, visits: [],
      since: d.startAt ?? '', last: d.startAt ?? '', lastDoctor: d.doctor, overdue: false,
    }
    x.total += d.debtSom
    x.visits.push(d)
    if (d.startAt && (!x.since || d.startAt < x.since)) x.since = d.startAt
    if (d.startAt && (!x.last || d.startAt > x.last)) { x.last = d.startAt; x.lastDoctor = d.doctor }
    if (d.dueOn && d.dueOn < today) x.overdue = true
    if (d.dueOn && (!x.due || d.dueOn < x.due)) x.due = d.dueOn
    map.set(key, x)
  }
  for (const x of map.values()) x.visits.sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
  return sortDebtors([...map.values()], 'sum')
}

/** «По сумме» — больший долг выше; «по давности» — с самого давнего неоплаченного визита. */
export function sortDebtors(list: Debtor[], sort: DebtorSort): Debtor[] {
  return [...list].sort((a, b) => sort === 'age' ? a.since.localeCompare(b.since) || b.total - a.total : b.total - a.total)
}

/** «1 визит в долг», «2 визита в долг», «5 визитов в долг». */
export function visitsText(n: number): string {
  const tail = n % 10 === 1 && n % 100 !== 11 ? 'визит' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'визита' : 'визитов'
  return `${n} ${tail} в долг`
}
