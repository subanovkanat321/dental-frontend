import { useState } from 'react'

import { somText } from '../../lib/time'
import { Sheet } from '../../lab/LabOrderDialog'
import { dayText, useReceive, type Order } from './api'

/**
 * «Пришло»: по позициям — сколько пришло на самом деле (по умолчанию — сколько заказали; 0 — не пришло) и цена за
 * единицу (подсказка — прошлая цена). Каждая пришедшая позиция станет обычной поставкой склада: остаток вырастет,
 * сумма — в «Расходах на склад», цена запомнится. Не пришедшее и всё ещё на минимуме вернётся в список к заказу.
 */
export function ReceiveSheet({ order: o, money, onClose }: { order: Order; money: boolean; onClose: () => void }) {
  const receive = useReceive()
  const [rows, setRows] = useState(() => o.items.map((i) => ({
    itemId: i.id, received: String(i.quantity), price: i.lastPriceSom != null ? String(i.lastPriceSom) : '',
  })))
  const set = (k: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === k ? { ...r, ...patch } : r)))
  const parsed = rows.map((r) => ({ itemId: r.itemId, received: Number(r.received || 0), price: r.price.trim() === '' ? null : Number(r.price) }))
  const valid = parsed.every((r) => Number.isInteger(r.received) && r.received >= 0 && (r.price == null || (Number.isFinite(r.price) && r.price >= 0)))
    && parsed.some((r) => r.received > 0)
  const total = parsed.reduce((sum, r) => sum + (r.price != null ? Math.round(r.price * r.received) : 0), 0)
  const submit = () => receive.mutate({
    id: o.id,
    items: parsed.map((r) => ({
      itemId: r.itemId, received: r.received,
      costSom: money && r.price != null && r.received > 0 ? Math.round(r.price * r.received) : undefined,
    })),
  }, { onSuccess: onClose })
  return (
    <Sheet title={`Пришло: «${o.supplierName}»`} onClose={onClose} className="purchase-receive"
      onSubmit={(e) => { e.preventDefault(); if (valid) submit() }}>
      <p className="hint">Заказ от {dayText(o.sentAt)}. Поправьте, если пришло не всё: 0 — не пришло.</p>
      <ul className="purchase-receive-list">
        {o.items.map((i, k) => (
          <li key={i.id}>
            <span className="purchase-receive-name"><strong>{i.name}</strong><span className="hint"> · заказали {i.quantity} {i.unit}</span></span>
            <span className="row">
              <label className="field"><span>Пришло, {i.unit}</span>
                <input type="number" min={0} inputMode="numeric" aria-label={`Пришло: ${i.name}`} value={rows[k]!.received}
                  onChange={(e) => set(k, { received: e.target.value })} />
              </label>
              {money && (
                <label className="field"><span>Цена за {i.unit}, сом</span>
                  <input type="number" min={0} inputMode="numeric" aria-label={`Цена: ${i.name}`} value={rows[k]!.price}
                    placeholder="необязательно" onChange={(e) => set(k, { price: e.target.value })} />
                </label>
              )}
            </span>
          </li>
        ))}
      </ul>
      {money && total > 0 && <p>Итого: <strong className="num">{somText(total)}</strong> <span className="hint">— пойдёт в «Расходы на склад»</span></p>}
      {receive.error && <p className="error" role="alert">{Object.values(receive.error.fieldErrors)[0] ?? receive.error.message}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="submit" className="btn primary" disabled={!valid || receive.isPending}>Принять на склад</button>
      </div>
    </Sheet>
  )
}
