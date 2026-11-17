import { useState, type FormEvent } from 'react'

import { addDays, somText, todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { useOrderStatus, usePay, type LabOrder } from './api'
import { Sheet } from './LabOrderDialog'

/** «Переделка»: причина и новый срок — работа снова у техника. */
export function ReworkDialog({ order, onClose }: { order: LabOrder; onClose: () => void }) {
  const today = todayIn()
  const [reason, setReason] = useState('')
  const [dueOn, setDueOn] = useState(addDays(today, 5))
  const status = useOrderStatus()
  const err = (k: string) => status.error?.fieldErrors[k]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    status.mutate({ id: order.id, status: 'REWORK', reason, dueOn }, { onSuccess: onClose })
  }
  return (
    <Sheet title={`Переделка: ${order.work}`} onClose={onClose} onSubmit={submit} className="lab-rework">
      <label className="field"><span>Причина</span>
        <input value={reason} required maxLength={300} autoFocus placeholder="Не села по прикусу, не тот цвет" onChange={(e) => setReason(e.target.value)} /></label>
      {err('reason') && <p className="error">{err('reason')}</p>}
      <label className="field"><span>Новый срок готовности</span>
        <DateInput aria-label="Новый срок готовности" value={dueOn} min={today} onChange={(e) => setDueOn(e.target.value)} /></label>
      {err('dueOn') && <p className="error">{err('dueOn')}</p>}
      {status.error && !Object.keys(status.error.fieldErrors).length && <p className="error" role="alert">{status.error.message}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="submit" className="btn primary" disabled={!reason.trim() || status.isPending}>Отправить на переделку</button>
      </div>
    </Sheet>
  )
}

/** «Оплатить технику»: сумма — цена работы; галочка «Записать в расходы» (статья «Зуботехническая лаборатория», на врача). */
export function PayDialog({ order, onClose }: { order: LabOrder; onClose: () => void }) {
  const [expense, setExpense] = useState(true)
  const pay = usePay()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    pay.mutate({ id: order.id, paid: true, expense }, { onSuccess: onClose })
  }
  return (
    <Sheet title="Оплатить технику" onClose={onClose} onSubmit={submit} className="lab-pay">
      <p>«{order.labName}» — {order.work}, {order.patientName}: <strong className="num">{somText(order.priceSom ?? 0)}</strong></p>
      <label className="check">
        <input type="checkbox" checked={expense} onChange={(e) => setExpense(e.target.checked)} />
        Записать в «Расходы» — статья «Зуботехническая лаборатория», врач {order.doctorName}
      </label>
      <p className="hint small">Расход врача: виден в «Расходах», «Моих расходах» и в «Чистыми за месяц». Уже записали расход сами — снимите галочку.</p>
      {pay.error && <p className="error" role="alert">{pay.error.message}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <button type="submit" className="btn primary" disabled={pay.isPending}>Оплачено</button>
      </div>
    </Sheet>
  )
}
