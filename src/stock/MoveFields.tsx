import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { isAssistant } from '../lib/roles'
import type { SupplyMove } from './supplyMove'

type Me = Schemas['BookingViewsMe']

/** Поля движения: сколько, сумма поставки (не ассистенту — он денег не видит), дата поставки. */
export function MoveFields({ m, me, unit }: { m: SupplyMove; me: Me; unit?: string }) {
  return (
    <>
      <label className="field">
        <span>Сколько{unit ? `, ${unit}` : ''}</span>
        <input type="number" min={1} step={1} inputMode="numeric" value={m.amount} onChange={(e) => m.setAmount(e.target.value)} />
      </label>
      {!(m.n > 0) && m.amount !== '' && <p className="error">Целое число больше 0</p>}
      {/* Ассистенту деньги не показываем: цену поставки вносит врач или админ */}
      {!isAssistant(me) && (
        <label className="field">
          <span>Сколько заплатили за поставку, сом — необязательно</span>
          <input type="number" min={0} inputMode="numeric" value={m.cost} onChange={(e) => m.setCost(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Дата поставки</span>
        <DateInput value={m.deliveredOn} max={todayIn()} onChange={(e) => e.target.value && m.setDeliveredOn(e.target.value)} />
      </label>
    </>
  )
}
