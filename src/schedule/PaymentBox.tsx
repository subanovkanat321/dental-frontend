import { useQuery } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { debtLine } from '../lib/debt'
import { serviceEmoji } from '../lib/serviceEmoji'
import { dateOf, shortDate, somText, todayIn } from '../lib/time'
import { useAppointmentAction } from './useAppointmentAction'
import { DateInput } from '../layout/DateInput'
import { useEarnings } from '../earnings/earnings'
import { seesOwnEarnings } from '../lib/roles'

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
 * - форма по шагам: стоимость → «всё сразу» или «часть, остальное потом» → чем заплатил (или
 *   «разными способами»); «Снять отметку оплаты» — отдельной кнопкой.
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
      <EarningsGain a={a} me={me} />
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

/**
 * «+1 200 сом к вашему дню» — врачу в карточке своего оплаченного приёма: спокойно, одной строкой, без
 * конфетти. Сумма — его процент от оплаты (условия из GET /api/me/earnings, как считает сервер);
 * без условий — сама оплата (так же «Мой заработок» показывает выручку). Только оклад — строки нет.
 */
function EarningsGain({ a, me }: { a: Appointment; me: Me }) {
  const own = seesOwnEarnings(me) && a.doctorId === me.doctorId && (a.paidSom ?? 0) > 0
  const earnings = useEarnings(me, own)
  const e = earnings.data
  if (!own || !e) return null
  const percent = Number(e.percent ?? 0)
  if (e.hasTerms && percent <= 0) return null
  const gain = e.hasTerms ? Math.round((a.paidSom ?? 0) * percent / 100) : a.paidSom ?? 0
  if (gain <= 0) return null
  const today = a.startAt != null && dateOf(a.startAt) === todayIn()
  return <p className="earn-gain">+{somText(gain)} {today ? 'к вашему дню' : 'к вашему заработку'}</p>
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

/** Как заплатил: один способ или «разными» — тогда сумма по каждому. */
type How = Method | 'SPLIT'
const HOW: [How, string][] = [...METHODS, ['SPLIT', 'Разными способами']]
type Split = Record<Method, string>
const NO_SPLIT: Split = { CASH: '', TRANSFER: '', CARD: '' }
const SPLIT_LABEL: Record<Method, string> = { CASH: 'Наличными, сом', TRANSFER: 'Переводом, сом', CARD: 'Картой, сом' }

/**
 * Оплата приёма по шагам — как говорят на кассе:
 * 1) сколько стоит приём (цены услуг кнопками, ещё раз — прибавить);
 * 2) заплатил всё сразу или часть — тогда сколько сейчас, остальное долгом (и до какого числа);
 * 3) чем заплатил: наличные, перевод, карта или «разными способами» — сумма по каждому.
 * Одна сумма вводится один раз: «всё сразу» — оплачено = стоимость; части считаются от «заплатил».
 */
function PayForm({ a, me, billOnly, parts: initialParts, onCancel }: {
  a: Appointment
  me: Me
  billOnly: boolean
  parts: Entry[]
  onCancel?: () => void
}) {
  const action = useAppointmentAction(a)
  const hadDebt = (a.debtSom ?? 0) > 0
  const [cost, setCost] = useState(String(a.chargeSom ?? a.paidSom ?? a.servicePriceSom ?? ''))
  const [whole, setWhole] = useState(!hadDebt)
  const [paidNow, setPaidNow] = useState(hadDebt ? String(a.paidSom ?? '') : '')
  const [due, setDue] = useState(a.dueOn ?? '')
  const startSplit = initialParts.length > 1
  const [how, setHow] = useState<How>(startSplit ? 'SPLIT' : a.paymentMethod ?? 'CASH')
  const [split, setSplit] = useState<Split>(() => {
    if (!startSplit) return NO_SPLIT
    const sums = { ...NO_SPLIT }
    for (const e of initialParts) if (e.method) sums[e.method] = String((Number(sums[e.method]) || 0) + (e.amountSom ?? 0))
    return sums
  })
  const [problem, setProblem] = useState('')
  const toCashier = me.hasReception && !me.reception

  const costNum = cost === '' ? null : Number(cost)
  const paid = whole ? costNum : paidNow === '' ? null : Number(paidNow)
  const rest = costNum != null && paid != null ? costNum - paid : null
  const splitSum = METHODS.reduce((sum, [m]) => sum + (Number(split[m]) || 0), 0)

  const pick = (price: number, add: boolean) => setCost(String(add ? (Number(cost) || 0) + price : price))

  const save = () => {
    setProblem('')
    if (costNum == null || costNum < 1) {
      setProblem('Впишите, сколько стоит приём')
      return
    }
    if (!whole) {
      if (paid == null || paid < 1) {
        setProblem('Впишите, сколько заплатил сейчас')
        return
      }
      if (paid >= costNum) {
        setProblem('Заплатил всё — выберите «Всё сразу»')
        return
      }
    }
    const amount = paid!
    let parts: { amountSom: number; method: Method }[] | undefined
    let method: Method = how === 'SPLIT' ? 'CASH' : how
    if (how === 'SPLIT') {
      parts = METHODS.filter(([m]) => Number(split[m]) > 0).map(([m]) => ({ amountSom: Number(split[m]), method: m }))
      if (splitSum !== amount) {
        setProblem(`По способам вышло ${somText(splitSum)}, а заплатил ${somText(amount)} — поправьте суммы`)
        return
      }
      if (parts.length < 2) {
        // Одним способом — не «разными»
        method = parts[0]?.method ?? 'CASH'
        parts = undefined
      } else method = parts[0]!.method
    }
    // Счёт с кассы, а пришло меньше — остаток долгом (стоимость = сумма счёта)
    const charge = !whole || (a.chargeSom != null && amount < a.chargeSom) ? costNum : undefined
    action.mutate({
      kind: 'payment',
      body: { amountSom: amount, method, chargeSom: charge, dueOn: !whole && due ? due : undefined, parts },
    })
  }
  const unmark = async () => {
    if (!await ask(`Снять отметку оплаты ${somText(a.paidSom ?? 0)}? Сумма пропадёт из «Кассы» и отчёта.`)) return
    action.mutate({ kind: 'payment', body: { method: a.paymentMethod ?? 'CASH' } })
  }
  const bill = () => {
    setProblem('')
    if (costNum == null || costNum < 1) {
      setProblem('Впишите, сколько вышло за приём')
      return
    }
    action.mutate({ kind: 'bill', body: { chargeSom: costNum } })
  }

  const error = problem || fieldError(action.error)
  const cashierButton = toCashier && (
    <button type="button" className={billOnly ? 'btn primary' : 'btn'} disabled={action.isPending} onClick={bill}>
      На кассу — оплатит в регистратуре
    </button>
  )
  const cancel = onCancel && <button type="button" className="link" onClick={onCancel}>Отмена</button>
  const costField = (title: string) => (
    <label className="field"><span>{title}</span>
      <input type="number" min={0} inputMode="numeric" placeholder="Сумма, сом" aria-label="Сумма, сом"
        value={cost} onChange={(e) => setCost(e.target.value)} />
    </label>
  )

  if (billOnly) {
    return (
      <form className="pay-form" aria-label="Сумма на кассу" onSubmit={(e) => { e.preventDefault(); bill() }}>
        {costField('Сколько вышло за приём, сом')}
        <PriceChips onPick={pick} />
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
      <div className="pay-step">
        <span className="pay-step-n" aria-hidden="true">1</span>
        <div className="pay-step-body">
          {costField('Стоимость приёма, сом')}
          <PriceChips onPick={pick} />
        </div>
      </div>

      <div className="pay-step">
        <span className="pay-step-n" aria-hidden="true">2</span>
        <div className="pay-step-body">
          <span className="pay-step-title">Сколько заплатил</span>
          <div className="segments" role="group" aria-label="Сколько заплатил">
            <button type="button" aria-pressed={whole} onClick={() => setWhole(true)}>
              Всё сразу{costNum ? ` · ${somText(costNum)}` : ''}</button>
            <button type="button" aria-pressed={!whole} onClick={() => setWhole(false)}>Часть, остальное потом</button>
          </div>
          {!whole && (
            <div className="payment-part">
              <label className="field"><span>Заплатил сейчас, сом</span>
                <input type="number" min={1} inputMode="numeric" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} /></label>
              {rest != null && rest > 0 && <p className="pay-rest">Остальное потом: <b className="num">{somText(rest)}</b> — станет долгом пациента</p>}
              <label className="field"><span>Доплатит до (можно не указывать)</span>
                <DateInput min={todayIn()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
            </div>
          )}
        </div>
      </div>

      <div className="pay-step">
        <span className="pay-step-n" aria-hidden="true">3</span>
        <div className="pay-step-body">
          <span className="pay-step-title">Чем заплатил</span>
          <div className="segments wrap" role="group" aria-label="Как заплатили">
            {HOW.map(([code, name]) => (
              <button key={code} type="button" aria-pressed={how === code} onClick={() => setHow(code)}>{name}</button>
            ))}
          </div>
          {how === 'SPLIT' && (
            <div className="payment-split">
              {METHODS.map(([m]) => (
                <label key={m} className="field"><span>{SPLIT_LABEL[m]}</span>
                  <input type="number" min={0} inputMode="numeric" placeholder="0" value={split[m]}
                    onChange={(e) => setSplit({ ...split, [m]: e.target.value })} /></label>
              ))}
              {paid != null && (
                <p className={splitSum === paid ? 'tone-ok' : 'hint'}>
                  {splitSum === paid ? `✓ Сходится: ${somText(paid)}` : `Распределено ${somText(splitSum)} из ${somText(paid)}`}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn primary" disabled={action.isPending}>
        {waiting ? 'Принять оплату' : 'Сохранить оплату'}{paid ? ` · ${somText(paid)}` : ''}</button>
      {cashierButton && <p className="hint small">Пациент платит в регистратуре? Впишите стоимость и передайте на кассу:</p>}
      {cashierButton}
      {a.paidSom != null && <button type="button" className="link danger-link" disabled={action.isPending} onClick={unmark}>Снять отметку оплаты</button>}
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
