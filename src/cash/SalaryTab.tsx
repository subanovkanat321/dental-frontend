import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { somText, todayIn } from '../lib/time'

type Row = Schemas['SalaryControllerSalaryRow']

const MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const monthTitle = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`)).replace(' г.', '')

/** 'YYYY-MM' прошлого месяца: зарплату обычно считают в начале следующего. */
function previousMonth(today = todayIn()): string {
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function termsText(r: Row): string {
  const percent = Number(r.percent ?? 0)
  const of = r.assistantId != null ? 'от выручки его врачей' : 'от выручки'
  const parts = [percent ? `${String(percent).replace('.', ',')}% ${of}` : '', r.baseSom ? `оклад ${somText(r.baseSom)}` : '']
  return parts.filter(Boolean).join(' + ') || 'Условия не заданы'
}

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «Касса → Зарплата»: к выплате врачу за месяц = оклад + процент от его выручки, ассистенту — от
 * выручки его врачей. Админ задаёт
 * условия и отмечает выплату (она же расход «Зарплата» — прибыль её учтёт); врач видит свою строку.
 * Считает сервер — здесь только показываем и отправляем.
 */
export function SalaryTab({ seesAll }: { seesAll: boolean }) {
  const [month, setMonth] = useState(previousMonth)
  const list = useQuery({
    queryKey: ['salaries', month],
    queryFn: () => unwrap(api.GET('/api/salaries', { params: { query: { month } } })),
  })
  const rows = list.data ?? []
  const due = rows.reduce((s, r) => s + Math.max(0, (r.dueSom ?? 0) - (r.paidSom ?? 0)), 0)
  return (
    <>
      <div className="analytics-filter" role="group" aria-label="Месяц зарплаты">
        <div className="segments">
          <button type="button" aria-pressed={month === previousMonth()} onClick={() => setMonth(previousMonth())}>Прошлый месяц</button>
          <button type="button" aria-pressed={month === todayIn().slice(0, 7)} onClick={() => setMonth(todayIn().slice(0, 7))}>Этот месяц</button>
        </div>
        <input type="month" aria-label="Месяц зарплаты" value={month} max={todayIn().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <p className="hint">Зарплата за {monthTitle(month)}: оклад + процент от выручки врача (оплаты пациентов за его приёмы в этом месяце);
        ассистенту — от выручки врачей, которым он помогает.</p>
      {list.isPending ? <p className="hint">Загрузка…</p>
        : list.error ? <p className="error">{list.error.message}</p>
          : rows.length === 0 ? <p className="hint">Врачей пока нет.</p> : (
            <>
              {seesAll && rows.length > 1 && <p className="total-line" aria-label="Осталось выплатить">Осталось выплатить: <b className="num">{somText(due)}</b></p>}
              {/* Ключ с месяцем: сменили месяц — открытая форма выплаты не переносит сумму прошлого */}
              {rows.map((r) => <SalaryCard key={`${month}-${r.doctorId != null ? `d${r.doctorId}` : `a${r.assistantId}`}`} row={r} month={month} seesAll={seesAll} />)}
            </>
          )}
    </>
  )
}

function SalaryCard({ row: r, month, seesAll }: { row: Row; month: string; seesAll: boolean }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const left = Math.max(0, (r.dueSom ?? 0) - (r.paidSom ?? 0))
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['salaries'] })
    void client.invalidateQueries({ queryKey: ['expenses'] })
    // Выплата — расход: прибыль в «Расходах» пересчитывается
    void client.invalidateQueries({ queryKey: ['spending'] })
  }
  return (
    <section className="card-block salary" aria-label={`Зарплата: ${r.doctor}`}>
      <div className="salary-head">
        <h2>{r.doctor}{r.assistantId != null && <span className="hint"> · ассистент</span>}</h2>
        {left === 0 && (r.dueSom ?? 0) > 0 && <span className="badge-ok">✅ Выплачено</span>}
      </div>
      <dl className="salary-sums">
        <div><dt>{r.assistantId != null ? 'Выручка врачей' : 'Выручка'}</dt><dd className="num">{somText(r.revenueSom ?? 0)}</dd></div>
        <div><dt>К выплате</dt><dd className="num strong">{somText(r.dueSom ?? 0)}</dd></div>
        <div><dt>Выплачено</dt><dd className="num">{somText(r.paidSom ?? 0)}</dd></div>
      </dl>
      <p className="hint">{termsText(r)}</p>
      {seesAll && !editing && !paying && (
        <div className="actions">
          {left > 0 && <button type="button" className="btn primary" onClick={() => setPaying(true)}>Выплатить {somText(left)}</button>}
          <button type="button" className="btn" onClick={() => setEditing(true)}>Условия</button>
        </div>
      )}
      {editing && <TermsForm row={r} month={month} onDone={() => { setEditing(false); refresh() }} onCancel={() => setEditing(false)} />}
      {paying && <PayForm row={r} month={month} left={left} onDone={() => { setPaying(false); refresh() }} onCancel={() => setPaying(false)} />}
    </section>
  )
}

function TermsForm({ row: r, month, onDone, onCancel }: { row: Row; month: string; onDone: () => void; onCancel: () => void }) {
  const [percent, setPercent] = useState(String(Number(r.percent ?? 0) || ''))
  const [base, setBase] = useState(r.baseSom ? String(r.baseSom) : '')
  const save = useMutation<Row, ApiError>({
    mutationFn: () => {
      const body = { percent: Number(percent.replace(',', '.') || 0), baseSom: Number(base || 0) }
      return unwrap(r.assistantId != null
        ? api.PUT('/api/salaries/assistants/{telegramId}', { params: { path: { telegramId: r.assistantId }, query: { month } }, body })
        : api.PUT('/api/salaries/{doctorId}', { params: { path: { doctorId: r.doctorId! }, query: { month } }, body }))
    },
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form className="form" aria-label={`Условия: ${r.doctor}`} onSubmit={submit}>
      <div className="row">
        <label className="field"><span>Процент от выручки</span>
          <input inputMode="decimal" value={percent} placeholder="например, 30" onChange={(e) => setPercent(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <label className="field"><span>Оклад в месяц, сом</span>
          <input inputMode="numeric" value={base} placeholder="0 — без оклада" onChange={(e) => setBase(e.target.value.replace(/\D/g, ''))} /></label>
      </div>
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}

function PayForm({ row: r, month, left, onDone, onCancel }: { row: Row; month: string; left: number; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(left))
  const pay = useMutation<Row, ApiError>({
    mutationFn: () => {
      const body = { month, amountSom: Number(amount || 0) }
      return unwrap(r.assistantId != null
        ? api.POST('/api/salaries/assistants/{telegramId}/pay', { params: { path: { telegramId: r.assistantId } }, body })
        : api.POST('/api/salaries/{doctorId}/pay', { params: { path: { doctorId: r.doctorId! } }, body }))
    },
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    pay.mutate()
  }
  return (
    <form className="form" aria-label={`Выплата: ${r.doctor}`} onSubmit={submit}>
      <label className="field"><span>Сумма выплаты, сом</span>
        <input inputMode="numeric" value={amount} autoFocus onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <p className="hint">Запишется в «Расходы» как «Зарплата за {monthTitle(month)}» на сегодня. Ошиблись — удалите этот расход в «Расходах».</p>
      {pay.error && <p className="error" role="alert">{errorText(pay.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={pay.isPending || !Number(amount)}>Выплачено</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}
