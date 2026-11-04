import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { saveCsv } from '../lib/csv'
import { somText } from '../lib/time'
import { materialsWord, signedSom } from '../earnings/earnings'

type Row = Schemas['NetMonthRow']

/** Как врач работает: сам (аренда кресла или «врачи работают независимо») или за клинику. */
function modeText(r: Row): string {
  if (!r.selfEmployed) return 'работает за клинику'
  return (r.rentSom ?? 0) > 0 ? 'работает сам (аренда)' : 'работает сам'
}

/** «Зарплата / аренда»: врачу за клинику — его оклад + процент, частному — аренда кресла. */
const payOf = (r: Row) => (r.selfEmployed ? r.rentSom ?? 0 : r.earnedSom ?? 0)

const dash = (v?: number | null) => (v == null ? '—' : signedSom(v))

/**
 * «Итог месяца по врачам» в «Касса → Расходы» — только тому, кто видит деньги всей клиники (сервер
 * отвечает 403 остальным). Каждый врач — по своим условиям: частному — «врачу чистыми», клинике от него
 * аренда; врачу за клинику — «клинике остаётся» после зарплаты, материалов и техника. Ниже —
 * сверка с «Прибылью»: итог по врачам − общие расходы ± склад ± выплаты = прибыль. Считает сервер
 * (GET /api/finance/net-month).
 */
export function NetMonthTable({ month }: { month: string }) {
  const q = useQuery({
    queryKey: ['net-month', 'clinic', month],
    queryFn: () => unwrap(api.GET('/api/finance/net-month', { params: { query: { month } } })),
  })
  if (q.isPending) return <section className="card-block"><h2>Итог месяца по врачам</h2><p className="hint">Загрузка…</p></section>
  if (q.error) return <section className="card-block"><h2>Итог месяца по врачам</h2><p className="error">{q.error.message}</p></section>
  const d = q.data
  const rows = d.rows ?? []
  const anySelf = rows.some((r) => r.selfEmployed)
  // «Итого»: зарплаты врачей за клинику и аренды частных — сумма по строкам, а не одно поле итога
  const pay = (r: Row) => (r.doctorId == null ? rows.reduce((s, x) => s + payOf(x), 0) : payOf(r))
  const anyShared = d.total?.clinicAfterSharedSom != null && (d.generalExpensesSom ?? 0) !== 0
  const csv = () => saveCsv(`итог-месяца-${month}`, [
    ['Врач', 'Как работает', 'Выручка', 'Зарплата / аренда', 'Материалы', 'Техник и лаб.', 'Врачу чистыми', 'Клинике остаётся', 'С долей общих расходов'],
    ...[...rows, ...(d.total ? [d.total] : [])].map((r) => [r.doctor ?? '', r.doctorId == null ? '' : modeText(r), r.revenueSom ?? 0, pay(r),
      r.materialsSom ?? 0, r.expensesSom ?? 0, r.doctorNetSom ?? '', r.clinicSom ?? 0, r.clinicAfterSharedSom ?? '']),
    [],
    ['Общие расходы клиники', '', '', '', '', '', '', -(d.generalExpensesSom ?? 0)],
    ['Склад: списано за клинику − куплено', '', '', '', '', '', '', d.supplySom ?? 0],
    ['Расходы частных врачей в «Расходах»', '', '', '', '', '', '', -(d.selfEmployedExpensesSom ?? 0)],
    ['Врачам: начислено − выплачено', '', '', '', '', '', '', d.payoutsSom ?? 0],
    ...(d.otherSom ? [['Прочее', '', '', '', '', '', '', d.otherSom]] : []),
    ['Прибыль клиники', '', '', '', '', '', '', d.profitSom ?? 0],
  ])
  const supply = d.supplySom ?? 0
  const payouts = d.payoutsSom ?? 0
  return (
    <section className="card-block net-month" aria-label="Итог месяца по врачам">
      <div className="block-head">
        <h2>Итог месяца по врачам</h2>
        {rows.length > 0 && <button type="button" className="btn ghost small" onClick={csv}>CSV</button>}
      </div>
      {rows.length === 0 ? <p className="hint">Врачей в этом месяце нет.</p> : (
        <div className="table-scroll">
          <table className="table" aria-label="Итог месяца по врачам">
            <thead><tr>
              <th>Врач</th>
              <th className="r">Выручка</th>
              <th className="r">Зарплата / аренда</th>
              <th className="r">Материалы ≈</th>
              <th className="r">Техник и лаб.</th>
              {anySelf && <th className="r">Врачу чистыми</th>}
              <th className="r">Клинике остаётся</th>
              {anyShared && <th className="r">С долей общих расходов</th>}
            </tr></thead>
            <tbody>
              {[...rows, ...(d.total ? [d.total] : [])].map((r) => {
                const total = r.doctorId == null
                return (
                  <tr key={r.doctorId ?? 'total'} className={total ? 'strong' : undefined}>
                    <td>{r.doctor}{!total && <div className="hint small">{modeText(r)}</div>}</td>
                    <td className="r nowrap num">{somText(r.revenueSom ?? 0)}</td>
                    <td className="r nowrap num">{total ? '' : `${r.selfEmployed ? 'аренда' : 'зарплата'} `}{somText(pay(r))}</td>
                    <td className="r nowrap num">
                      {somText(r.materialsSom ?? 0)}
                      {(r.unpricedMaterials ?? 0) > 0 && <div className="hint small tone-wait">+{r.unpricedMaterials} без цены</div>}
                    </td>
                    <td className="r nowrap num">{somText(r.expensesSom ?? 0)}</td>
                    {anySelf && <td className="r nowrap num">{dash(r.doctorNetSom)}</td>}
                    <td className={`r nowrap num strong${(r.clinicSom ?? 0) < 0 ? ' tone-bad' : ''}`}>{signedSom(r.clinicSom ?? 0)}</td>
                    {anyShared && <td className={`r nowrap num${(r.clinicAfterSharedSom ?? 0) < 0 ? ' tone-bad' : ''}`}>{dash(r.clinicAfterSharedSom)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <dl className="net-lines" aria-label="Сверка с прибылью">
        <div><dt>Клинике от врачей</dt><dd className="num">{signedSom(d.total?.clinicSom ?? 0)}</dd></div>
        <div><dt>Общие расходы клиники (без врача)</dt><dd className="num">−{somText(d.generalExpensesSom ?? 0)}</dd></div>
        {supply !== 0 && (
          <div><dt>Склад: {supply < 0 ? 'куплено больше, чем списано' : 'списано больше, чем куплено'}
            <span className="hint small"> (куплено {somText(d.purchasedSom ?? 0)}, списано за клинику ≈ {somText(d.clinicMaterialsSom ?? 0)})</span></dt>
          <dd className="num">{signedSom(supply)}</dd></div>
        )}
        {(d.selfEmployedExpensesSom ?? 0) > 0 && (
          <div><dt>Расходы частных врачей, записанные в «Расходы»</dt><dd className="num">−{somText(d.selfEmployedExpensesSom ?? 0)}</dd></div>
        )}
        {payouts !== 0 && (
          <div><dt>Врачам: {payouts > 0 ? 'начислено больше, чем выплачено' : 'выплачено больше, чем начислено'}
            <span className="hint small"> (начислено {signedSom(d.accruedSom ?? 0)}, выплачено {somText(d.paidSom ?? 0)}
              {(d.rentReceivedSom ?? 0) > 0 ? `, получено от врачей ${somText(d.rentReceivedSom ?? 0)}` : ''})</span></dt>
          <dd className="num">{signedSom(payouts)}</dd></div>
        )}
        {(d.otherSom ?? 0) !== 0 && <div><dt>Прочее</dt><dd className="num">{signedSom(d.otherSom ?? 0)}</dd></div>}
        <div className="net-total"><dt>Прибыль клиники</dt>
          <dd className={`num strong ${(d.profitSom ?? 0) < 0 ? 'tone-bad' : 'tone-ok'}`} aria-label="Прибыль клиники по врачам">{signedSom(d.profitSom ?? 0)}</dd></div>
      </dl>
      <p className="hint small">
        Материалы здесь — списанное на приёмах по средней цене покупки (оценка), а прибыль клиники считает покупки склада —
        деньги из кассы; разница — строкой «Склад». Зарплата — начисленная за месяц по условиям «Зарплаты», в прибыли — выплаты
        по дате. {anyShared && 'Доля общих расходов — оценка: общие расходы делим между врачами по их выручке.'}
        {(d.total?.unpricedMaterials ?? 0) > 0 && ` У ${materialsWord(d.total?.unpricedMaterials ?? 0)} нет цены — в «Материалах» их нет.`}
      </p>
    </section>
  )
}
