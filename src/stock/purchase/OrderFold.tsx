import type { Schemas } from '../../api/client'
import { isAssistant } from '../../lib/roles'
import { Fold } from '../../layout/Fold'
import { Loading } from '../../layout/Loading'
import { Select } from '../../layout/Select'
import { somText } from '../../lib/time'
import { dayText, useSuppliers, useSupplyOrder, useSupplyPrices } from './api'
import './purchase.css'

type Me = Schemas['BookingViewsMe']
type Supply = Schemas['SupplyView']

/**
 * Карточка материала → «Заказ и цены»: где обычно берём (поставщик), «Добавить в заказ» и последние цены у каждого
 * поставщика — дешевле сверху, чтобы сравнить. Цены ассистенту не показываем (сервер: 403).
 */
export function OrderFold({ supply: s, me }: { supply: Supply; me: Me }) {
  const suppliers = useSuppliers()
  const order = useSupplyOrder()
  const money = !isAssistant(me)
  const prices = useSupplyPrices(s.id, money)
  const best = prices.data?.suppliers[0]
  return (
    <Fold title="Заказ и цены" meta={s.supplierName ?? (best ? `${somText(best.priceSom)}/${s.unit}` : undefined)} label="Заказ и цены">
      <div className="form">
        <label className="field"><span>Где обычно берём</span>
          <Select value={s.supplierId == null ? '' : String(s.supplierId)} disabled={order.isPending} onChange={(e) => order.mutate({
            supplyId: s.id, supplierId: e.target.value ? Number(e.target.value) : null, wanted: Boolean(s.orderWanted),
          })}>
            <option value="">Не выбран</option>
            {(suppliers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
        {!s.low && (
          <label className="check">
            <input type="checkbox" checked={Boolean(s.orderWanted)} disabled={order.isPending}
              onChange={(e) => order.mutate({ supplyId: s.id, supplierId: s.supplierId, wanted: e.target.checked })} />
            Добавить в заказ
          </label>
        )}
        {s.low && !s.orderedAt && <p className="hint small">Ниже минимума — уже в «Склад → Заказ».</p>}
        {order.error && <p className="error" role="alert">{order.error.message}</p>}
      </div>
      {money && (
        <section aria-label="Цены у поставщиков">
          <h3>Цены</h3>
          {prices.isPending ? <Loading /> : prices.data?.suppliers.length ? (
            <ul className="supply-prices">
              {prices.data.suppliers.map((p, k) => (
                <li key={p.supplierId ?? 0}>
                  <span>{p.supplierName ?? 'Без поставщика'}<span className="hint"> · {dayText(p.day)}</span></span>
                  <span className={k === 0 && prices.data!.suppliers.length > 1 ? 'num cheapest' : 'num'}>{somText(p.priceSom)}/{s.unit}</span>
                </li>
              ))}
            </ul>
          ) : <p className="hint">Цен ещё нет: введите сумму при поставке или в «Пришло».</p>}
        </section>
      )}
    </Fold>
  )
}
