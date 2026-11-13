import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { monthRange, somText, todayIn } from '../lib/time'
import { MonthPicker } from '../layout/MonthPicker'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { positions } from '../earnings/earnings'
import { rowOpen } from '../lib/rowClick'

const MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const monthTitle = (date: string) => MONTH.format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`)).replace(/ г\.$/, '')
const DAY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' })
/** Дата поставки «12 нояб.» — день без времени (LocalDate сервера). */
const dayText = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`)).replace(/\.$/, '')

/**
 * «Расходы на склад» (руководитель) — сколько заплатили за поставки за месяц и какая это доля
 * выручки, сколько ушло на приёмы по цене покупки; каждая поставка строкой (нажали — карточка
 * материала с историей), столбики за полгода и по материалам. Поставки без суммы занижают расходы —
 * об этом предупреждаем. «＋ Поставка» — тот же приход, что «Пришла поставка» в карточке материала.
 * own — «Мои закупки» врача: то же по его складу (сервер сам сужает), без доли выручки.
 */
export function SpendingBlock({ own = false, separate = false, canOpen, onOpen, onAdd }: {
  own?: boolean
  /** «Свой склад у каждого врача» — в списке столбец «Чей склад» */
  separate?: boolean
  /** Материал есть на складе (не удалён) — его карточку можно открыть */
  canOpen: (supplyId: number) => boolean
  onOpen: (supplyId: number) => void
  onAdd: () => void
}) {
  const [month, setMonth] = useState(todayIn().slice(0, 7))
  const { from, to } = monthRange(month)
  const data = useQuery({
    queryKey: ['spending', 'stock', month],
    queryFn: () => unwrap(api.GET('/api/supplies/spending', { params: { query: { from, to } } })),
  })
  const r = data.data
  const share = r?.revenueSom ? Math.round((r.purchasedSom / r.revenueSom) * 100) : null
  const max = Math.max(1, ...(r?.months ?? []).map((m) => m.purchasedSom))
  return (
    <section className="card-block spending" aria-label={own ? 'Мои закупки' : 'Расходы на склад'}>
      <SubHelp title={own ? 'Мои закупки' : 'Расходы на склад'}>
        Каждая поставка — с суммой, которую ввели при «＋ Поставка» здесь или «＋ Пришла поставка» в карточке материала.
        Нажмите на строку — откроется материал с историей. «Ушло на приёмы» — списанное по средней цене покупки (оценка).
        {own ? ' Здесь только ваш склад: в «Чистыми» материалы считаются по списанию, закупки — справочно.' : ''}
      </SubHelp>
      {/* Месяц и «＋ Поставка» — в строку шапки «Склада» */}
      <HeadTools>
        <MonthPicker label="Месяц расходов на склад" value={month} max={todayIn().slice(0, 7)} onChange={setMonth} />
        <button type="button" className="btn primary push" onClick={onAdd}>＋ Поставка</button>
      </HeadTools>
      <p className="hint">{own ? 'Здесь — сколько вы потратили на материалы своего склада' : 'Здесь — сколько потратили на материалы'}: каждая поставка с суммой из карточки материала.</p>
      {data.isPending && <Loading />}
      {data.error && <p className="error">{data.error.message}</p>}
      {r && (
        <>
          {/* Плитки, как «Прибыль» в «Кассе» (без класса строки слипались: «Заплатили26 700 сом6%») */}
          <div className="methods profit">
            <div>Заплатили за поставки<b>{somText(r.purchasedSom)}</b>{share != null && <span className="hint">{share}% выручки</span>}</div>
            <div>Ушло на приёмы<b>≈ {somText(r.usedSom)}</b><span className="hint">по цене покупки</span></div>
            {r.lossesSom > 0 && <div>Потери и пересчёт<b>≈ {somText(r.lossesSom)}</b><span className="hint">по цене покупки</span></div>}
          </div>
          {r.unpricedDeliveries > 0 && (
            <p className="tone-bad">Поставок без суммы: {r.unpricedDeliveries} — расходы занижены. Вводите сумму при «＋ Поставка».</p>
          )}
          {r.unpricedUsed > 0 && <p className="tone-wait">Без цены: {r.unpricedUsed} {positions(r.unpricedUsed)} — их цену ни разу не вводили, в сумму не вошли.</p>}
          <h3>Поставки за месяц</h3>
          {r.deliveries?.length ? (
            <table className="table" aria-label="Поставки за месяц">
              <thead>
                <tr><th>Дата</th><th>Материал</th><th className="r">Сколько</th><th className="r">Сумма</th>{separate && !own && <th>Чей склад</th>}</tr>
              </thead>
              <tbody>
                {r.deliveries.map((d) => {
                  const open = !d.archived && canOpen(d.supplyId) ? () => onOpen(d.supplyId) : null
                  return (
                    <tr key={d.id} {...rowOpen(open)}>
                      <td className="nowrap">{d.day ? dayText(d.day) : ''}</td>
                      <td>
                        {open ? <button type="button" className="row-link" onClick={open}>{d.name}</button> : d.name}
                        {d.archived && <span className="hint"> (удалён)</span>}
                      </td>
                      <td className="r nowrap">{d.quantity} {d.unit}</td>
                      <td className="r nowrap">{d.costSom != null ? somText(d.costSom) : <span className="tone-bad">без суммы</span>}</td>
                      {separate && !own && <td className="hint">{d.doctorName ?? 'общий'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <EmptyState compact title="В этом месяце поставок не было" />}
          {(r.months?.length ?? 0) > 1 && (
            <>
              <h3>За полгода</h3>
              <div className="bars months" role="list" aria-label="Покупки склада по месяцам">
                {r.months!.map((m) => (
                  <div key={m.month} className="bar" role="listitem" aria-label={`${monthTitle(m.month!)}: ${somText(m.purchasedSom)}`}
                    title={`${monthTitle(m.month!)}: ${somText(m.purchasedSom)}`}>
                    <span style={{ height: `${(m.purchasedSom / max) * 100}%` }} />
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
          ) : <EmptyState compact title="В этом месяце поставок и списаний не было" />}
        </>
      )}
    </section>
  )
}
