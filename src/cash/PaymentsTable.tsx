import { useCallback, useState } from 'react'

import type { Schemas } from '../api/client'
import { SortTh } from '../layout/SortTh'
import { shortDate, somText } from '../lib/time'
import { useSort } from '../lib/useSort'

type Row = Schemas['AppointmentServiceReportRow']
type Key = 'when' | 'patient' | 'doctor' | 'service' | 'status' | 'paid' | 'debt'

const METHOD_TEXT: Record<string, string> = { CASH: 'Наличные', TRANSFER: 'Перевод', CARD: 'Карта' }

/**
 * Приёмы с оплатами таблицей: по умолчанию новые сверху; сортировка по любой колонке, поиск по
 * пациенту и услуге, фильтры «способ оплаты», «врач», «только с долгом». Нажать строку — карточка приёма.
 */
export function PaymentsTable({ rows, label, onOpen, active, withStatus = false }: {
  rows: Row[]
  label: string
  onOpen?: (id: number) => void
  active?: number | null
  withStatus?: boolean
}) {
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('')
  const [doctor, setDoctor] = useState('')
  const [debtOnly, setDebtOnly] = useState(false)
  const doctors = [...new Set(rows.map((r) => r.doctor).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, 'ru'))
  const methods = [...new Set(rows.map((r) => r.method).filter((m): m is string => Boolean(m)))]
  const text = query.trim().toLowerCase()
  const filtered = rows.filter((r) => (!text || `${r.patient ?? ''} ${r.service ?? ''}`.toLowerCase().includes(text))
    && (!method || r.method === method) && (!doctor || r.doctor === doctor) && (!debtOnly || (r.debtSom ?? 0) > 0))
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
          <select aria-label="Способ оплаты" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Любой способ</option>
            {methods.map((m) => <option key={m} value={m}>{METHOD_TEXT[m] ?? m}</option>)}
          </select>
        )}
        {doctors.length > 1 && (
          <select aria-label="Врач" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
            <option value="">Все врачи</option>
            {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <label className="check"><input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} /> Только с долгом</label>
      </div>
      <p className="hint">Оплачено: <b className="num">{somText(paid)}</b>{debt ? <> · долги: <b className="num">{somText(debt)}</b></> : null} · приёмов: {filtered.length}</p>
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
                {withStatus && <td className="hint">{r.status}</td>}
                <td className="r num nowrap">{r.paidSom != null ? somText(r.paidSom) : '—'}{r.method && <span className="hint"> · {(METHOD_TEXT[r.method] ?? r.method).toLowerCase()}</span>}</td>
                <td className={`r num nowrap${r.debtSom ? ' tone-bad' : ''}`}>{r.debtSom ? somText(r.debtSom) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="hint">{rows.length ? 'По фильтрам ничего не нашлось.' : 'Приёмов за этот период нет.'}</p>}
    </div>
  )
}
