import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { api, unwrap } from '../api/client'
import type { Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { textMatches } from '../lib/search'
import { shortDate, somText } from '../lib/time'
import { CalmRow, RowMenu, type MenuItem } from '../patients/CalmList'
import { dayMonth, remindedText } from '../lib/debt'
import { DebtPromiseForm, DebtRemindForm } from './DebtRemind'
import { debtorsOf, sortDebtors, visitsText, type Debtor, type DebtorSort, type FamilyOf } from './debtors'
import { OpeningDebtsList } from './OpeningDebts'
import { useOpeningDebts } from './useOpeningDebts'
import './debtors.css'

type Debt = Schemas['PaymentQueryDebt']

const SORTS: [DebtorSort, string][] = [['sum', 'По сумме'], ['age', 'По давности']]

/**
 * «Касса → Должники»: сверху итог плитками, под ним спокойный список (DESIGN.md → «Спокойный список»):
 * имя, одна серая строка (последний визит · врач · сколько визитов в долг), сумма справа красным,
 * «Напомнить» (бот или WhatsApp — DebtRemind), «Принять оплату» (карточка самого давнего неоплаченного приёма) и «⋯» —
 * «Обещал оплатить до…», пациент и каждый визит. «обещал до 25.11» в серой строке, просрочено — красным.
 * Строка целиком открывает пациента (там телефон и WhatsApp). Долги из прежней программы — отдельным
 * блоком того же вида; их видит руководитель (другим сервер отвечает 403 — блока и плитки нет).
 */
export function DebtorsTab({ rows, pending, error, onOpen, onOpenPatient }: {
  rows: Debt[] | undefined
  pending: boolean
  error?: string
  onOpen: (appointmentId: number) => void
  onOpenPatient?: (patientId: number) => void
}) {
  const families = useQuery({ queryKey: ['families'], queryFn: () => unwrap(api.GET('/api/families')) })
  const old = useOpeningDebts()
  const [byFamily, setByFamily] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<DebtorSort>('sum')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const familyOf: FamilyOf = new Map()
  for (const f of families.data ?? []) for (const m of f.members ?? []) familyOf.set(m.id, { id: f.id, name: f.name ?? 'Семья' })
  const grouped = byFamily && familyOf.size > 0

  const help = (
    <SubHelp title="Должники">
      Кто сколько должен за приёмы: сначала больший долг (или давний — «По давности»). «Напомнить» — вежливое сообщение
      от бота клиники или в WhatsApp, не чаще раза в 3 дня; «⋯ → Обещал оплатить до…» — в этот день придёт задача
      «Проверить оплату». «Принять оплату» открывает самый давний неоплаченный приём, нажатие на строку — карточку пациента. «Старые долги» —
      суммы из прежней программы, без приёма и врача: в выручку приёмов их погашение не входит.
    </SubHelp>
  )
  if (pending) return <>{help}<Loading /></>
  if (error) return <>{help}<p className="error">{error}</p></>

  const all = debtorsOf(rows ?? [], undefined, grouped ? familyOf : undefined)
  const oldRows = old.data ?? []
  if (!all.length && !oldRows.length) return <>{help}<EmptyState fill title="Должников нет 🎉" /></>

  const visitsSom = all.reduce((s, x) => s + x.total, 0)
  const oldSom = oldRows.reduce((s, d) => s + d.amountSom, 0)
  const patients = new Set([...(rows ?? []).filter((d) => d.debtSom).map((d) => d.patientId), ...oldRows.map((d) => d.patientId)]).size
  const overdue = all.filter((x) => x.overdue)
  const filterOn = onlyOverdue && overdue.length > 0
  const list = sortDebtors(all.filter((x) => (!filterOn || x.overdue) && textMatches(x.patient, query)), sort)
  const oldList = filterOn ? [] : oldRows.filter((d) => textMatches(d.patient, query))
    .sort((a, b) => sort === 'age' ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || b.amountSom - a.amountSom : b.amountSom - a.amountSom)

  const tiles: [string, string, string?][] = [['Должны всего', somText(visitsSom + oldSom)], ['Пациентов', String(patients)]]
  if (oldSom) tiles.push(['Старые долги из прежней программы', somText(oldSom)])
  if (overdue.length) tiles.push(['Просрочили оплату', `${overdue.length} · ${somText(overdue.reduce((s, x) => s + x.total, 0))}`, 'tone-bad'])

  return (
    <>
      {help}
      <HeadTools>
        <div className="head-filters debtors-tools">
          <input type="search" className="search" aria-label="Поиск должника" placeholder="Имя пациента"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {overdue.length > 0 && (
            <div className="segments" role="group" aria-label="Какие долги">
              <button type="button" aria-pressed={!filterOn} onClick={() => setOnlyOverdue(false)}>Все</button>
              <button type="button" aria-pressed={filterOn} onClick={() => setOnlyOverdue(true)}>Просрочили · {overdue.length}</button>
            </div>
          )}
          <Select aria-label="Порядок" value={sort} onChange={(e) => setSort(e.target.value as DebtorSort)}>
            {SORTS.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </Select>
          {familyOf.size > 0 && (
            <label className="check"><input type="checkbox" checked={byFamily} onChange={(e) => setByFamily(e.target.checked)} /> Семьи вместе</label>
          )}
        </div>
      </HeadTools>
      <div className="debtors calm-stack">
        <section className="card-block" aria-label="Итог по долгам">
          <ul className={`survey-tiles tile-grid debtors-tiles n${tiles.length}`} aria-label="Итог">
            {tiles.map(([title, value, tone]) => (
              <li key={title} className="survey-tile"><span className="hint">{title}</span><b className={tone ? `num ${tone}` : 'num'}>{value}</b></li>
            ))}
          </ul>
        </section>
        {all.length > 0 && (
          <section className="debtors-block" aria-label="Должники">
            {list.length
              ? <ul className="calm-list" aria-label="Должники по приёмам">
                {list.map((x) => <DebtorRow key={x.key} x={x} onOpen={onOpen} onOpenPatient={onOpenPatient} />)}
              </ul>
              : <EmptyState compact title={query.trim() ? `Никого не нашли по «${query.trim()}»` : 'Никто не просрочил'} />}
          </section>
        )}
        {oldRows.length > 0 && !filterOn && (
          <section className="debtors-block" aria-label="Старые долги из прежней программы">
            <h3>Старые долги из прежней программы <span className="hint num">· {somText(oldSom)}</span></h3>
            {oldList.length
              ? <OpeningDebtsList rows={oldList} onOpenPatient={onOpenPatient} />
              : <EmptyState compact title={`Никого не нашли по «${query.trim()}»`} />}
          </section>
        )}
      </div>
    </>
  )
}

/** Строка должника: имя, серая строка, сумма красным, «Напомнить», «Принять оплату» и «⋯». */
function DebtorRow({ x, onOpen, onOpenPatient }: {
  x: Debtor
  onOpen: (appointmentId: number) => void
  onOpenPatient?: (patientId: number) => void
}) {
  // Что раскрыто под строкой: напоминание или срок — пациенту (у семьи — кому из её членов)
  const [form, setForm] = useState<{ kind: 'remind' | 'promise'; patientId: number; name: string } | null>(null)
  const open = x.patientId != null && onOpenPatient && !form ? () => onOpenPatient(x.patientId!) : null
  // Семья — несколько пациентов: напоминают каждому своё (сумма — его), из «⋯»
  const members = new Map<number, string>()
  for (const v of x.visits) members.set(v.patientId, v.patient ?? '—')
  const family = x.key.startsWith('f')
  const reminded = x.visits.reduce<string | undefined>((max, v) => v.remindedAt && (!max || v.remindedAt > max) ? v.remindedAt : max, undefined)
  const due: ReactNode = x.due && (
    <span className={x.overdue ? 'debt-due tone-bad' : 'debt-due'}>{x.overdue ? 'обещал' : 'оплатит'} до {dayMonth(x.due)}</span>
  )
  const sub = [
    x.last && `последний визит ${shortDate(x.last)}`,
    x.lastDoctor,
    visitsText(x.visits.length),
  ].filter(Boolean).join(' · ')
  const single = !family && x.patientId != null
  const items: MenuItem[] = [
    ...(single ? [{ label: x.due ? 'Обещал оплатить до… (изменить)' : 'Обещал оплатить до…', onSelect: () => setForm({ kind: 'promise', patientId: x.patientId!, name: x.patient }) }] : []),
    ...(family ? [...members].flatMap(([id, name]) => [
      { label: `Напомнить: ${name}`, onSelect: () => setForm({ kind: 'remind', patientId: id, name }) },
      { label: `Обещал оплатить до…: ${name}`, onSelect: () => setForm({ kind: 'promise', patientId: id, name }) },
    ]) : []),
    ...(x.patientId != null && onOpenPatient ? [{ label: 'Открыть пациента', onSelect: () => onOpenPatient(x.patientId!) }] : []),
    ...x.visits.map((v) => ({
      label: `Визит ${v.startAt ? shortDate(v.startAt) : ''}${v.service ? ` · ${v.service}` : ''} · ${somText(v.debtSom)}`,
      onSelect: () => onOpen(v.appointmentId),
    })),
  ]
  const formDue = form ? x.visits.find((v) => v.patientId === form.patientId && v.dueOn)?.dueOn : undefined
  return (
    <CalmRow open={open} name={x.patient}
      flags={x.overdue && <span className="chip calm-flag s-bad">Просрочил</span>}
      sub={due ? <>{due} · {sub}</> : sub}
      meta={(
        <>
          <span className="debt-sum num">{somText(x.total)}</span>
          {reminded && <span className="debt-reminded">{remindedText(reminded)}</span>}
        </>
      )}
      action={!form && (
        <>
          {single && <button type="button" className="btn" onClick={() => setForm({ kind: 'remind', patientId: x.patientId!, name: x.patient })}>Напомнить</button>}
          <button type="button" className="btn" onClick={() => onOpen(x.visits[0]!.appointmentId)}>Принять оплату</button>
        </>
      )}
      menu={!form && <RowMenu label={`Ещё: ${x.patient}`} items={items} />}>
      {form?.kind === 'remind' && <DebtRemindForm patientId={form.patientId} name={form.name} onDone={() => setForm(null)} />}
      {form?.kind === 'promise' && <DebtPromiseForm patientId={form.patientId} dueOn={formDue} onDone={() => setForm(null)} />}
    </CalmRow>
  )
}
