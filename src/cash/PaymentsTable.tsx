import { useCallback, useState } from 'react'

import type { Schemas } from '../api/client'
import { SortTh } from '../layout/SortTh'
import { addDays, shortDate, somText, todayIn, ZONE } from '../lib/time'
import { useSort } from '../lib/useSort'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { EmptyState } from '../layout/EmptyState'

type Row = Schemas['AppointmentServiceReportRow']
type Key = 'when' | 'patient' | 'doctor' | 'service' | 'status' | 'paid' | 'debt'

/** День приёма по Бишкеку: 'YYYY-MM-DD'. */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE })
const dayOfInstant = (instant: string) => DAY.format(new Date(instant))

const METHOD_TEXT: Record<string, string> = { CASH: 'Наличные', TRANSFER: 'Перевод', CARD: 'Карта' }
const STATUS_TEXT: Record<string, [string, string]> = {
  DONE: ['Состоялся', 's-done'], NO_SHOW: ['Неявка', 's-bad'], CANCELLED: ['Отменён', 's-quiet'],
  SCHEDULED: ['Записан', 's-ok'], REQUESTED: ['Заявка', 's-request'],
}

/**
 * Приёмы с оплатами таблицей: по умолчанию новые сверху; сортировка по любой колонке, поиск по
 * пациенту и услуге, фильтры «способ оплаты», «врач», «только с долгом». Нажать строку — карточка приёма.
 */
export function PaymentsTable({ rows, label, onOpen, active, withStatus = false, days }: {
  rows: Row[]
  label: string
  onOpen?: (id: number) => void
  active?: number | null
  withStatus?: boolean
  /** Отчёт за месяц: можно сузить до дней внутри него («с … по …», «сегодня», «вчера», «7 дней») */
  days?: { from: string; to: string }
}) {
  const [dayFrom, setDayFrom] = useState(days?.from ?? '')
  const [dayTo, setDayTo] = useState(days?.to ?? '')
  const [bounds, setBounds] = useState(days)
  if (days && (days.from !== bounds?.from || days.to !== bounds?.to)) {
    // Другой месяц — фильтр дней снова на весь месяц
    setBounds(days)
    setDayFrom(days.from)
    setDayTo(days.to)
  }
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [doctor, setDoctor] = useState('')
  const [debtOnly, setDebtOnly] = useState(false)
  const [status, setStatus] = useState('')
  const statuses = [...new Set(rows.map((r) => r.status).filter((x): x is string => Boolean(x)))]
  const doctors = [...new Set(rows.map((r) => r.doctor).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, 'ru'))
  const methods = [...new Set(rows.map((r) => r.method).filter((m): m is string => Boolean(m)))]
  const text = query.trim().toLowerCase()
  const filtered = rows.filter((r) => (!text || `${r.patient ?? ''} ${r.service ?? ''}`.toLowerCase().includes(text))
    && (!method || r.method === method) && (!doctor || r.doctor === doctor) && (!debtOnly || (r.debtSom ?? 0) > 0)
    && (!status || r.status === status)
    && (!days || !r.startAt || (dayOfInstant(r.startAt) >= dayFrom && dayOfInstant(r.startAt) <= dayTo)))
  const value = useCallback((r: Row, key: Key) => ({
    when: r.startAt, patient: r.patient, doctor: r.doctor, service: r.service, status: r.status, paid: r.paidSom, debt: r.debtSom,
  })[key], [])
  const { sorted, sort, toggle } = useSort<Row, Key>(filtered, value, { key: 'when', desc: true })
  const paid = filtered.reduce((s, r) => s + (r.paidSom ?? 0), 0)
  const debt = filtered.reduce((s, r) => s + (r.debtSom ?? 0), 0)

  return (
    <div className="payments">
      <div className="filters" role="group" aria-label={`Фильтры: ${label}`}>
        <input type="search" aria-label="Пациент или услуга" placeholder="Пациент или услуга" value={query} onChange={(e) => setQuery(e.target.value)} />
        {methods.length > 1 && (
          <Select aria-label="Способ оплаты" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Любой способ</option>
            {methods.map((m) => <option key={m} value={m}>{METHOD_TEXT[m] ?? m}</option>)}
          </Select>
        )}
        {doctors.length > 1 && (
          <Select aria-label="Врач" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
            <option value="">Все врачи</option>
            {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        )}
        {withStatus && statuses.length > 1 && (
          <Select aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Любой статус</option>
            {statuses.map((x) => <option key={x} value={x}>{STATUS_TEXT[x]?.[0] ?? x}</option>)}
          </Select>
        )}
        {days && (() => {
          const today = todayIn()
          const quick: [string, string, string][] = [
            ['Весь месяц', days.from, days.to],
            ['Сегодня', today, today],
            ['Вчера', addDays(today, -1), addDays(today, -1)],
            ['7 дней', addDays(today, -6), today],
          ]
          return (
            <div className="day-filter" role="group" aria-label="Дни">
              <label className="field"><span>С</span>
                <DateInput aria-label="С дня" value={dayFrom} min={days.from} max={dayTo} onChange={(e) => e.target.value && setDayFrom(e.target.value)} /></label>
              <label className="field"><span>По</span>
                <DateInput aria-label="По день" value={dayTo} min={dayFrom} max={days.to} onChange={(e) => e.target.value && setDayTo(e.target.value)} /></label>
              <div className="chips-pick">
                {quick.filter(([, f, t]) => t >= days.from && f <= days.to).map(([name, f, t]) => {
                  const from = f < days.from ? days.from : f
                  const to = t > days.to ? days.to : t
                  return <button key={name} type="button" className="chip" aria-pressed={dayFrom === from && dayTo === to}
                    onClick={() => { setDayFrom(from); setDayTo(to) }}>{name}</button>
                })}
              </div>
            </div>
          )
        })()}
        <label className="check"><input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} /> Только с долгом</label>
      </div>
      <p className="hint">Оплачено: <b className="num">{somText(paid)}</b>{debt ? <> · долги: <b className="num">{somText(debt)}</b></> : null} · приёмов: {filtered.length}
        {withStatus && <> · состоялось: {filtered.filter((r) => r.status === 'DONE').length}
          {filtered.some((r) => r.status === 'NO_SHOW') && <span className="tone-bad"> · неявок: {filtered.filter((r) => r.status === 'NO_SHOW').length}</span>}</>}
        {Object.entries(filtered.reduce<Record<string, number>>((acc, r) => (r.method && r.paidSom ? { ...acc, [r.method]: (acc[r.method] ?? 0) + r.paidSom } : acc), {}))
          .map(([m, sum]) => ` · ${(METHOD_TEXT[m] ?? m).toLowerCase()}: ${somText(sum)}`).join('')}</p>
      {sorted.length ? (
        <table className="table" aria-label={label}>
          <thead>
            <tr>
              <SortTh k="when" title="Когда" sort={sort} onSort={toggle} desc />
              <SortTh k="patient" title="Пациент" sort={sort} onSort={toggle} />
              <SortTh k="doctor" title="Врач" sort={sort} onSort={toggle} />
              <SortTh k="service" title="Услуга" sort={sort} onSort={toggle} />
              {withStatus && <SortTh k="status" title="Статус" sort={sort} onSort={toggle} />}
              <SortTh k="paid" title="Оплачено" sort={sort} onSort={toggle} desc right />
              <SortTh k="debt" title="Долг" sort={sort} onSort={toggle} desc right />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.id === active ? 'active' : undefined}>
                <td className="nowrap num">{r.startAt ? shortDate(r.startAt, true) : ''}</td>
                <td>{onOpen ? <button type="button" className="row-link" onClick={() => onOpen(r.id!)}>{r.patient}</button> : r.patient}</td>
                <td>{r.doctor}</td>
                <td className="hint">{r.service ?? '—'}</td>
                {withStatus && <td><span className={`chip small ${STATUS_TEXT[r.status ?? '']?.[1] ?? 's-quiet'}`}>{STATUS_TEXT[r.status ?? '']?.[0] ?? r.status}</span></td>}
                <td className="r num nowrap">{r.paidSom != null ? somText(r.paidSom) : '—'}{r.method && <span className="hint"> · {(METHOD_TEXT[r.method] ?? r.method).toLowerCase()}</span>}</td>
                <td className={`r num nowrap${r.debtSom ? ' tone-bad' : ''}`}>{r.debtSom ? somText(r.debtSom) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <EmptyState title={rows.length ? 'По фильтрам ничего не нашлось' : 'Приёмов за этот период нет'} />}
    </div>
  )
}
