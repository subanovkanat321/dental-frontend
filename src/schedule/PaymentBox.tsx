import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { debtLine } from '../lib/debt'
import { serviceEmoji } from '../lib/serviceEmoji'
import { shortDate, somText, todayIn } from '../lib/time'
import { useAppointmentAction } from './useAppointmentAction'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Method = NonNullable<Schemas['AppointmentControllerPayment']['method']>
type Entry = Schemas['PaymentQueryEntry']

const METHODS: [Method, string][] = [['CASH', 'Наличные'], ['TRANSFER', 'Перевод'], ['CARD', 'Карта']]
const METHOD_NAME: Record<Method, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта' }
const methodName = (m?: Method) => (m ? METHOD_NAME[m] : '')

type View = 'show' | 'edit' | 'bill' | 'extra' | 'rest' | 'billed'

/**
 * Оплата состоявшегося приёма — как paymentBox прежнего приложения:
 * - оплачен: сумма, «Изменить», долг со сроком или «Оплачено полностью», история платежей;
 *   была только предоплата — «Указать стоимость и принять остаток»; есть долг — «Принять доплату»;
 * - «На кассу» (в клинике есть регистратура, а я врач): «К оплате на кассе», врачу — «Изменить сумму»;
 * - форма: сумма, цены услуг кнопками (ещё раз — прибавить), «Не всё сразу» со стоимостью и сроком,
 *   «＋ Ещё способ оплаты» — часть наличными, часть переводом. Пустая сумма — снять отметку оплаты.
 * После ответа сервера карточка пересоздаёт блок (ключ — версия приёма), он открывается в нужном виде.
 */
export function PaymentBox({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  // Регистратура открывает счёт с кассы — сразу форма оплаты с суммой счёта
  const [view, setView] = useState<View>(a.paidSom != null ? 'show' : a.chargeSom != null && !me.reception ? 'billed' : 'edit')
  const history = useQuery({
    queryKey: ['payments', a.id, a.version, a.paidSom],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/payments', { params: { path: { id: a.id! } } })),
    enabled: a.paidSom != null,
  })
  const back = () => setView(a.paidSom != null ? 'show' : a.chargeSom != null ? 'billed' : 'edit')

  if (view === 'extra') return <div className="payment"><ExtraForm a={a} onCancel={back} /></div>
  if (view === 'rest') return <div className="payment"><RestForm a={a} onCancel={back} /></div>
  if (view === 'edit' || view === 'bill') {
    // «Изменить» оплату частями — подставить части; ждём историю, чтобы форма открылась уже заполненной
    const needParts = view === 'edit' && a.paidSom != null && a.chargeSom == null
    if (needParts && history.isPending) return <div className="payment"><p className="hint">Загрузка…</p></div>
    return (
      <div className="payment">
        <PayForm a={a} me={me} billOnly={view === 'bill'} parts={needParts ? history.data ?? [] : []}
          onCancel={a.paidSom != null || (a.chargeSom != null && !me.reception) ? back : undefined} />
      </div>
    )
  }
  if (view === 'billed') {
    const doctorSide = !me.reception
    return (
      <div className="payment">
        <p className="payment-done">
          <span>К оплате на кассе: {somText(a.chargeSom ?? 0)}</span>
          {doctorSide && <button type="button" className="link" onClick={() => setView('bill')}>Изменить сумму</button>}
        </p>
        <p className="hint small">{doctorSide ? 'Регистратура примет оплату — ей пришло сообщение.' : 'Пациент платит здесь — отметьте, как заплатил.'}</p>
        <button type="button" className="btn primary" onClick={() => setView('edit')}>Принять оплату</button>
      </div>
    )
  }

  const debt = debtLine(a)
  const list = history.data ?? []
  const split = list.length > 1 && a.chargeSom == null
  // Доплаты (платежи в разное время): «оплату заново» сервер не примет (409 has-installments) — меняют доплатой
  const installments = new Set(list.map((e) => e.paidAt)).size > 1
  return (
    <div className="payment">
      <p className="payment-done">
        <span>{a.chargeSom != null ? `${somText(a.paidSom ?? 0)} из ${somText(a.chargeSom)}`
          : split ? somText(a.paidSom ?? 0) : `${somText(a.paidSom ?? 0)} · ${methodName(a.paymentMethod)}`}</span>
        {!installments && <button type="button" className="link" onClick={() => setView('edit')}>Изменить</button>}
      </p>
      {installments && <p className="hint small">Есть доплаты — сумму меняют доплатой; ошиблись в платеже — напишите в техподдержку.</p>}
      {debt ? <p className={`tone-${debt.tone} payment-debt`}>{debt.text}</p>
        : a.chargeSom != null ? <p className="tone-ok">✅ Оплачено полностью</p> : null}
      {list.length > 1 && (
        <p className="hint payment-history">
          {split ? list.map((e) => `${methodName(e.method)} ${somText(e.amountSom ?? 0)}`).join(' + ')
            : list.map((e) => `${e.paidAt ? shortDate(e.paidAt) : ''} — ${somText(e.amountSom ?? 0)}, ${methodName(e.method)}`).join(' · ')}
        </p>
      )}
      {a.depositStatus === 'RECEIVED' && a.chargeSom == null && (
        <button type="button" className="btn primary" onClick={() => setView('rest')}>Указать стоимость и принять остаток</button>
      )}
      {debt && <button type="button" className="btn primary" onClick={() => setView('extra')}>Принять доплату</button>}
    </div>
  )
}

function MethodButtons({ value, onChange, label = 'Как заплатили' }: { value: Method; onChange: (m: Method) => void; label?: string }) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {METHODS.map(([code, name]) => (
        <button key={code} type="button" aria-pressed={value === code} onClick={() => onChange(code)}>{name}</button>
      ))}
    </div>
  )
}

function fieldError(e: { fieldErrors: Record<string, string>; message: string } | null): string {
  if (!e) return ''
  const f = e.fieldErrors
  return f.amountSom ?? f.method ?? f.chargeSom ?? f.dueOn ?? e.message
}

/** Цены услуг клиники кнопками: нажать — сумма в поле, ещё раз (или другую) — прибавить. */
function PriceChips({ onPick }: { onPick: (price: number, add: boolean) => void }) {
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 10 * 60_000 })
  const [used, setUsed] = useState(false)
  const list = (services.data ?? []).filter((s) => s.active && s.priceSom != null)
  if (!list.length) return null
  return (
    <div className="price-hints" role="group" aria-label="Цены услуг">
      {list.map((s) => (
        <button key={s.id} type="button" className="chip" title="Нажмите ещё раз — прибавится"
          onClick={() => {
            onPick(s.priceSom!, used)
            setUsed(true)
          }}><span aria-hidden="true">{serviceEmoji(s.name)} </span>{s.name} · {somText(s.priceSom!)}</button>
      ))}
    </div>
  )
}

type Part = { key: number; amount: string; method: Method }

function PayForm({ a, me, billOnly, parts: initialParts, onCancel }: {
  a: Appointment
  me: Me
  billOnly: boolean
  parts: Entry[]
  onCancel?: () => void
}) {
  const action = useAppointmentAction(a)
  const first = initialParts.length > 1 ? initialParts[0] : undefined
  const [amount, setAmount] = useState(String(first?.amountSom ?? a.paidSom ?? a.chargeSom ?? a.servicePriceSom ?? ''))
  const [method, setMethod] = useState<Method>(first?.method ?? a.paymentMethod ?? 'CASH')
  const [partial, setPartial] = useState((a.debtSom ?? 0) > 0)
  const [charge, setCharge] = useState(String(a.chargeSom ?? a.servicePriceSom ?? ''))
  const [due, setDue] = useState(a.dueOn ?? '')
  const [parts, setParts] = useState<Part[]>(initialParts.length > 1
    ? initialParts.slice(1).map((e, i) => ({ key: i, amount: String(e.amountSom ?? ''), method: e.method ?? 'TRANSFER' }))
    : [])
  const [problem, setProblem] = useState('')
  const toCashier = me.hasReception && !me.reception

  const pick = (price: number, add: boolean) => {
    const [value, set] = partial ? [charge, setCharge] : [amount, setAmount]
    set(String(add ? (Number(value) || 0) + price : price))
  }
  const togglePartial = (on: boolean) => {
    // Включили — стоимость из того, что было в «Оплате»; пусть впишут взнос
    if (on && charge === '' && amount !== '') setCharge(amount)
    setPartial(on)
  }

  const save = () => {
    setProblem('')
    const main = amount === '' ? null : Number(amount)
    const extra = parts.filter((p) => p.amount !== '').map((p) => ({ amountSom: Number(p.amount), method: p.method }))
    if (extra.length && main == null) {
      setProblem('Впишите сумму первой части')
      return
    }
    const paid = main == null ? null : main + extra.reduce((s, p) => s + p.amountSom, 0)
    // Стёрли сумму у оплаченного приёма — это снятие оплаты: деньги пропадут из «Кассы», переспросить
    if (paid == null && a.paidSom != null
      && !window.confirm(`Снять отметку оплаты ${somText(a.paidSom)}? Сумма пропадёт из «Кассы» и отчёта.`)) return
    let cost = partial && charge !== '' ? Number(charge) : null
    if (partial && paid != null && cost != null && cost <= paid) {
      setProblem('Стоимость должна быть больше, чем оплачено сейчас — иначе это полная оплата')
      return
    }
    // Счёт с кассы, а заплатил меньше — остаток долгом, стоимость — сумма счёта
    if (!partial && paid != null && a.paidSom == null && a.chargeSom != null && paid < a.chargeSom) cost = a.chargeSom
    action.mutate({
      kind: 'payment',
      body: {
        amountSom: paid ?? undefined,
        method,
        chargeSom: cost ?? undefined,
        dueOn: partial && due ? due : undefined,
        parts: extra.length && main != null ? [{ amountSom: main, method }, ...extra] : undefined,
      },
    })
  }
  const bill = () => {
    setProblem('')
    if (amount === '' || Number(amount) < 1) {
      setProblem('Впишите, сколько вышло за приём')
      return
    }
    action.mutate({ kind: 'bill', body: { chargeSom: Number(amount) } })
  }

  const error = problem || fieldError(action.error)
  const cashierButton = toCashier && (
    <button type="button" className={billOnly ? 'btn primary' : 'btn'} disabled={action.isPending} onClick={bill}>
      На кассу — оплатит в регистратуре
    </button>
  )
  const cancel = onCancel && <button type="button" className="link" onClick={onCancel}>Отмена</button>
  const amountField = (title: string) => (
    <label className="field"><span>{title}</span>
      <input type="number" min={0} inputMode="numeric" placeholder="Сумма, сом" aria-label="Сумма, сом"
        value={amount} onChange={(e) => setAmount(e.target.value)} />
    </label>
  )

  if (billOnly) {
    return (
      <form className="pay-form" aria-label="Сумма на кассу" onSubmit={(e) => { e.preventDefault(); bill() }}>
        {amountField('Сколько вышло за приём, сом')}
        <PriceChips onPick={(p, add) => setAmount(String(add ? (Number(amount) || 0) + p : p))} />
        {error && <p className="error" role="alert">{error}</p>}
        {cashierButton}
        {cancel}
      </form>
    )
  }
  const waiting = a.paidSom == null && a.chargeSom != null
  return (
    <form className="pay-form" aria-label="Оплата" onSubmit={(e) => { e.preventDefault(); save() }}>
      {waiting && <p className="payment-done">К оплате на кассе: {somText(a.chargeSom!)}</p>}
      {amountField(partial ? 'Оплачено сейчас, сом' : 'Оплата, сом')}
      <PriceChips onPick={pick} />
      <label className="check">
        <input type="checkbox" checked={partial} onChange={(e) => togglePartial(e.target.checked)} />
        Не всё сразу — остальное доплатит позже
      </label>
      {partial && (
        <div className="payment-part">
          <label className="field"><span>Стоимость приёма, сом</span>
            <input type="number" min={0} inputMode="numeric" value={charge} onChange={(e) => setCharge(e.target.value)} /></label>
          <label className="field"><span>Доплатит до (можно не указывать)</span>
            <input type="date" min={todayIn()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
      )}
      <MethodButtons value={method} onChange={setMethod} />
      {parts.map((p, i) => (
        <div key={p.key} className="payment-extra-row">
          <label className="field"><span>＋ Ещё</span>
            <input type="number" min={1} inputMode="numeric" placeholder="Сумма, сом" aria-label={`Ещё оплачено, сом (${i + 2})`}
              value={p.amount} onChange={(e) => setParts(parts.map((x) => x.key === p.key ? { ...x, amount: e.target.value } : x))} /></label>
          <MethodButtons label={`Как заплатили (${i + 2})`} value={p.method}
            onChange={(m) => setParts(parts.map((x) => x.key === p.key ? { ...x, method: m } : x))} />
          <button type="button" className="link" onClick={() => setParts(parts.filter((x) => x.key !== p.key))}>Убрать</button>
        </div>
      ))}
      <button type="button" className="link" onClick={() => setParts([...parts, { key: Date.now(), amount: '', method: 'TRANSFER' }])}>＋ Ещё способ оплаты</button>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn primary" disabled={action.isPending}>{waiting ? 'Принять оплату' : 'Сохранить оплату'}</button>
      {a.paidSom != null && <p className="hint small">Сотрите сумму и сохраните — отметка оплаты снимется.</p>}
      {cashierButton && <p className="hint small">Пациент платит в регистратуре? Впишите сумму и передайте на кассу:</p>}
      {cashierButton}
      {cancel}
    </form>
  )
}

/** Доплата долга: сумма (не больше долга) и способ. */
function ExtraForm({ a, onCancel }: { a: Appointment; onCancel: () => void }) {
  const action = useAppointmentAction(a)
  const [amount, setAmount] = useState(String(a.debtSom ?? ''))
  const [method, setMethod] = useState<Method>(a.paymentMethod ?? 'CASH')
  return (
    <form className="pay-form" aria-label="Доплата" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'extra', body: { amountSom: amount === '' ? undefined : Number(amount), method } })
    }}>
      <label className="field"><span>Доплата (долг {somText(a.debtSom ?? 0)})</span>
        <input type="number" min={1} max={a.debtSom} inputMode="numeric" aria-label="Доплата, сом" autoFocus
          value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <MethodButtons value={method} onChange={setMethod} />
      {action.error && <p className="error" role="alert">{fieldError(action.error)}</p>}
      <button type="submit" className="btn primary" disabled={action.isPending}>Сохранить доплату</button>
      <button type="button" className="link" onClick={onCancel}>Отмена</button>
    </form>
  )
}

/** После предоплаты: сколько стоил приём — остаток станет долгом, дальше «Принять доплату». */
function RestForm({ a, onCancel }: { a: Appointment; onCancel: () => void }) {
  const action = useAppointmentAction(a)
  const [cost, setCost] = useState(String(a.servicePriceSom ?? ''))
  return (
    <form className="pay-form" aria-label="Стоимость приёма" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'charge', body: { chargeSom: Number(cost) || undefined } })
    }}>
      <label className="field"><span>Сколько стоил приём, сом (предоплата {somText(a.paidSom ?? 0)} уже есть)</span>
        <input type="number" min={a.paidSom} inputMode="numeric" autoFocus value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      {action.error && <p className="error" role="alert">{fieldError(action.error)}</p>}
      <button type="submit" className="btn primary" disabled={action.isPending}>Дальше — остаток</button>
      <button type="button" className="link" onClick={onCancel}>Отмена</button>
    </form>
  )
}
