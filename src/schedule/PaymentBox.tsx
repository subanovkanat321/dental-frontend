import { useState, type FormEvent } from 'react'

import type { Schemas } from '../api/client'
import { somText } from '../lib/time'
import { useAppointmentAction } from './useAppointmentAction'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Method = NonNullable<Schemas['AppointmentControllerPayment']['method']>

const METHODS: [Method, string][] = [['CASH', 'Наличные'], ['TRANSFER', 'Перевод'], ['CARD', 'Карта']]
const METHOD_NAME: Record<Method, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта' }

/**
 * Оплата состоявшегося приёма — те же правила, что в Mini App (paymentBox в app.js):
 * - не оплачен: сумма и способ; «Не всё сразу» — стоимость, остаток станет долгом;
 *   в клинике есть регистратура, а я не она — «На кассу»: сумму примет регистратура;
 * - ждёт оплаты на кассе: «Принять оплату» с суммой из счёта;
 * - оплачен с долгом: «Принять доплату».
 */
export function PaymentBox({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  if (a.paidSom != null) {
    return (
      <div className="payment">
        <p className="payment-done">
          {a.chargeSom != null ? `${somText(a.paidSom)} из ${somText(a.chargeSom)}` : somText(a.paidSom)}
          {a.chargeSom == null && a.paymentMethod && <span className="hint"> · {METHOD_NAME[a.paymentMethod]}</span>}
          {a.debtSom ? <span className="tone-wait"> · долг {somText(a.debtSom)}</span> : null}
        </p>
        {(a.debtSom ?? 0) > 0 && <PayForm a={a} me={me} mode="extra" />}
      </div>
    )
  }
  if (a.chargeSom != null) {
    return (
      <div className="payment">
        <p className="payment-done">К оплате на кассе: {somText(a.chargeSom)}</p>
        <p className="hint small">{me.reception ? 'Пациент платит здесь — отметьте, как заплатил.' : 'Регистратура примет оплату — ей пришло сообщение.'}</p>
        <PayForm a={a} me={me} mode="cashier" />
      </div>
    )
  }
  return (
    <div className="payment">
      <PayForm a={a} me={me} mode="new" />
    </div>
  )
}

function PayForm({ a, me, mode }: { a: Appointment; me: Me; mode: 'new' | 'cashier' | 'extra' }) {
  const action = useAppointmentAction(a)
  const initial = mode === 'extra' ? a.debtSom : mode === 'cashier' ? a.chargeSom : a.servicePriceSom
  const [amount, setAmount] = useState(initial != null ? String(initial) : '')
  const [method, setMethod] = useState<Method>('CASH')
  const [partial, setPartial] = useState(false)
  const [charge, setCharge] = useState(a.servicePriceSom != null ? String(a.servicePriceSom) : '')
  const [problem, setProblem] = useState('')
  const toCashier = mode === 'new' && me.hasReception && !me.reception

  const sum = Number(amount)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setProblem('')
    if (!amount || sum < 0) {
      setProblem('Впишите сумму')
      return
    }
    if (mode === 'extra') {
      action.mutate({ kind: 'extra', body: { amountSom: sum, method } })
    } else if (mode === 'cashier') {
      // Заплатил меньше счёта — остаток долгом, стоимость приёма — сумма счёта
      const bill = a.chargeSom ?? 0
      action.mutate({ kind: 'payment', body: { amountSom: sum, method, chargeSom: sum < bill ? bill : undefined } })
    } else {
      action.mutate({ kind: 'payment', body: { amountSom: sum, method, chargeSom: partial && charge ? Number(charge) : undefined } })
    }
  }
  const bill = () => {
    setProblem('')
    if (!amount || sum < 1) {
      setProblem('Впишите, сколько вышло за приём')
      return
    }
    action.mutate({ kind: 'bill', body: { chargeSom: sum } })
  }

  const error = problem || (action.error && (action.error.fieldErrors.amountSom ?? action.error.fieldErrors.chargeSom
    ?? action.error.fieldErrors.method ?? action.error.message))
  const label = mode === 'extra' ? 'Доплата, сом' : partial ? 'Заплатил сейчас, сом' : 'Сумма, сом'
  return (
    <form className="pay-form" onSubmit={submit} aria-label={mode === 'extra' ? 'Доплата' : 'Оплата'}>
      <label className="field">
        <span>{label}</span>
        <input type="number" min={0} step={100} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {mode === 'new' && (
        <label className="check">
          <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
          Не всё сразу — остальное доплатит позже
        </label>
      )}
      {partial && mode === 'new' && (
        <label className="field">
          <span>Стоимость приёма, сом</span>
          <input type="number" min={0} step={100} inputMode="numeric" value={charge} onChange={(e) => setCharge(e.target.value)} />
        </label>
      )}
      <div className="segments" role="group" aria-label="Как заплатили">
        {METHODS.map(([code, name]) => (
          <button key={code} type="button" aria-pressed={method === code} onClick={() => setMethod(code)}>{name}</button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn primary" disabled={action.isPending}>
        {mode === 'extra' ? 'Принять доплату' : mode === 'cashier' ? 'Принять оплату' : 'Сохранить оплату'}
      </button>
      {toCashier && (
        <button type="button" className="btn" disabled={action.isPending} onClick={bill}>На кассу — оплатит в регистратуре</button>
      )}
    </form>
  )
}
