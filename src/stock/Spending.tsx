import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { monthRange, somText, todayIn } from '../lib/time'

const MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const monthTitle = (date: string) => MONTH.format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`)).replace(/ г\.$/, '')

/**
 * «Расходы на склад» (админ) — как в прежнем приложении: сколько заплатили за поставки за месяц
 * и какая это доля выручки, сколько ушло на приёмы по цене покупки, столбики за полгода и по
 * материалам. Поставки без суммы занижают расходы — об этом предупреждаем.
 */
export function SpendingBlock() {
  const [month, setMonth] = useState(todayIn().slice(0, 7))
  const { from, to } = monthRange(month)
  const data = useQuery({
    queryKey: ['spending', 'stock', month],
    queryFn: () => unwrap(api.GET('/api/supplies/spending', { params: { query: { from, to } } })),
  })
  const r = data.data
  const share = r?.revenueSom ? Math.round(((r.purchasedSom ?? 0) / r.revenueSom) * 100) : null
  const max = Math.max(1, ...(r?.months ?? []).map((m) => m.purchasedSom ?? 0))
  return (
    <section className="card-block spending" aria-label="Расходы на склад">
      <div className="block-head">
        <h2>Расходы на склад · {monthTitle(`${month}-01`)}</h2>
        <input type="month" aria-label="Месяц расходов на склад" value={month} max={todayIn().slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      {data.isPending && <p className="hint">Загрузка…</p>}
      {data.error && <p className="error">{data.error.message}</p>}
      {r && (
        <>
          <div className="methods">
            <div>Заплатили за поставки<b>{somText(r.purchasedSom ?? 0)}</b>{share != null && <span className="hint">{share}% выручки</span>}</div>
            <div>Ушло на приёмы<b>≈ {somText(r.usedSom ?? 0)}</b><span className="hint">по цене покупки</span></div>
          </div>
          {(r.unpricedDeliveries ?? 0) > 0 && (
            <p className="tone-bad">Поставок без суммы: {r.unpricedDeliveries} — расходы занижены. Вводите сумму при «Пришла поставка».</p>
          )}
          {(r.unpricedUsed ?? 0) > 0 && <p className="hint">Без цены: {r.unpricedUsed} — их цену ни разу не вводили, в сумму не вошли.</p>}
          {(r.months?.length ?? 0) > 1 && (
            <>
              <h3>За полгода</h3>
              <div className="bars months" role="list" aria-label="Покупки склада по месяцам">
                {r.months!.map((m) => (
                  <div key={m.month} className="bar" role="listitem" aria-label={`${monthTitle(m.month!)}: ${somText(m.purchasedSom ?? 0)}`}
                    title={`${monthTitle(m.month!)}: ${somText(m.purchasedSom ?? 0)}`}>
                    <span style={{ height: `${((m.purchasedSom ?? 0) / max) * 100}%` }} />
                    <small className="hint">{MONTH_SHORT.format(new Date(`${m.month}T00:00:00Z`))}</small>
                  </div>
                ))}
              </div>
            </>
          )}
          <h3>По материалам</h3>
          {r.items?.length ? (
            <table className="table" aria-label="Расходы по материалам">
              <thead><tr><th>Материал</th><th className="r">Куплено</th><th className="r">Ушло</th></tr></thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.supplyId}>
                    <td>{i.name}{i.archived && <span className="hint"> (удалён)</span>}</td>
                    <td className="r nowrap">{i.bought ? `${i.bought} ${i.unit}` : ''}{i.boughtSom ? <span className="hint"> · {somText(i.boughtSom)}</span> : null}</td>
                    <td className="r nowrap">{i.used ? `${i.used} ${i.unit}` : ''}{i.used && i.usedSom != null ? <span className="hint"> · ≈ {somText(i.usedSom)}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">В этом месяце поставок и списаний не было.</p>}
        </>
      )}
    </section>
  )
}
