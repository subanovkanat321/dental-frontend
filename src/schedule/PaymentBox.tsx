import { useQuery } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { debtLine } from '../lib/debt'
import { serviceEmoji } from '../lib/serviceEmoji'
import { dateOf, shortDate, somText, todayIn } from '../lib/time'
import { useAppointmentAction } from './useAppointmentAction'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { serviceOptions, usePopularServices } from '../clinic/serviceOptions'
import { useEarnings } from '../earnings/earnings'
import { seesAdvance, seesOwnEarnings } from '../lib/roles'
import { useAdvance } from '../patients/advance'
import { Loading } from '../layout/Loading'
import { discountText, reasonText } from '../lib/discount'
import { DiscountField } from './DiscountField'
import { initialPayView, type PayView } from './payView'
import { draftOf, draftProblem, draftSom, useDiscountPolicy, type DiscountDraft } from './discountDraft'
import { EditButton } from '../layout/EditButton'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']
type Method = NonNullable<Schemas['AppointmentControllerPayment']['method']>
type Entry = Schemas['PaymentQueryEntry']

const METHODS: [Method, string][] = [['CASH', 'Наличные'], ['TRANSFER', 'Перевод'], ['CARD', 'Карта']]
const METHOD_NAME: Record<Method, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта', ADVANCE: 'с аванса' }
const methodName = (m?: Method) => (m ? METHOD_NAME[m] : '')

/**
 * Сколько можно оплатить «С аванса» (V243) в этой форме: остаток аванса пациента (семьи) плюс то, что этот приём уже
 * оплатил с аванса, — «Изменить» оплату заменит прежние платежи, сервер их тоже не считает. 0 — кнопки нет.
 */
function useAdvanceFor(a: Appointment, me: Me, spentHere: number): number {
  const advance = useAdvance(a.patient?.id, seesAdvance(me) && a.status === 'DONE')
  return (advance.data?.balanceSom ?? 0) + spentHere
}

type View = PayView

/**
 * Оплата состоявшегося приёма — как paymentBox прежнего приложения:
 * - оплачен: сумма, «Изменить», долг со сроком или «Оплачено полностью», история платежей;
 *   была только предоплата — «Указать стоимость и принять остаток»; есть долг — «Принять доплату»;
 * - «На кассу» (в клинике есть регистратура, а я врач): «К оплате на кассе», врачу — «Изменить сумму»;
 * - форма по шагам: стоимость → «всё сразу» или «часть, остальное потом» → чем заплатил (или
 *   «разными способами»); «Снять отметку оплаты» — отдельной кнопкой.
 * После ответа сервера карточка пересоздаёт блок (ключ — версия приёма), он открывается в нужном виде.
 */
export function PaymentBox({ appointment: a, me, open, mainOutside = false, quiet = false, onView }: {
  appointment: Appointment
  me: Me
  /** Открыть сразу форму: нажали «Принять оплату» / «Принять доплату» в нижней панели телефона */
  open?: 'edit' | 'extra'
  /** Главная кнопка («Принять оплату», «Принять доплату») — в нижней панели телефона: здесь её нет, блок — сводка */
  mainOutside?: boolean
  /** Главное действие карточки другое («Записать на следующий визит») — здесь залитых кнопок нет */
  quiet?: boolean
  /** Открыли или закрыли форму — карточка прячет нижнюю «Принять оплату», пока форма открыта */
  onView?: (view: PayView) => void
}) {
  // Регистратура открывает счёт с кассы — сразу форма оплаты с суммой счёта
  // Не оплачено — одной строкой с кнопкой: форма с подставленной ценой на полэкрана сбивала с толку
  const [view, setViewState] = useState<View>(open ?? initialPayView(a, me))
  const setView = (v: View) => { setViewState(v); onView?.(v) }
  const mainClass = quiet ? 'btn' : 'btn primary'
  const history = useQuery({
    queryKey: ['payments', a.id, a.version, a.paidSom],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/payments', { params: { path: { id: a.id } } })),
    enabled: a.paidSom != null,
  })
  const back = () => setView(a.paidSom != null ? 'show' : a.chargeSom != null ? 'billed' : 'unpaid')
  // Этот приём уже оплачен с аванса — при «Изменить» эти деньги снова доступны (сервер сотрёт прежние платежи)
  const spentHere = (history.data ?? []).filter((e) => e.method === 'ADVANCE').reduce((sum, e) => sum + e.amountSom, 0)

  if (view === 'unpaid') return <Unpaid a={a} onPay={mainOutside ? undefined : () => setView('edit')} primary={!quiet} />
  if (view === 'extra') return <div className="payment"><ExtraForm a={a} me={me} onCancel={back} /></div>
  if (view === 'rest') return <div className="payment"><RestForm a={a} onCancel={back} /></div>
  if (view === 'edit' || view === 'bill') {
    // «Изменить» оплату частями — подставить части; ждём историю, чтобы форма открылась уже заполненной
    const needParts = view === 'edit' && a.paidSom != null && a.chargeSom == null
    if (needParts && history.isPending) return <div className="payment"><Loading /></div>
    return (
      <div className="payment">
        <PayForm a={a} me={me} billOnly={view === 'bill'} parts={needParts ? history.data ?? [] : []} spentHere={spentHere}
          onCancel={back} />
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
        {!mainOutside && <button type="button" className={mainClass} data-pay-main onClick={() => setView('edit')}>Принять оплату</button>}
      </div>
    )
  }

  const debt = debtLine(a)
  const list = history.data ?? []
  // Запись на 0 сом («всё в долг», бесплатно) — не платёж: в истории её не показываем, но доплаты после неё считаем
  const shown = list.filter((e) => e.amountSom > 0)
  const split = list.length > 1 && a.chargeSom == null
  // Доплаты (платежи в разное время): «оплату заново» сервер не примет (409 has-installments) — меняют доплатой
  const installments = new Set(list.map((e) => e.paidAt)).size > 1
  // «Сейчас ничего — всё в долг»: 0 сом со стоимостью — не «Бесплатно» и без способа оплаты
  const allInDebt = a.paidSom === 0 && (a.chargeSom ?? 0) > 0
  // Оплачено полностью — одной строкой «✅ Оплачено 6 000 сом · наличные», без «6 000 из 6 000» и второй строки
  const fullyPaid = !debt && a.chargeSom != null && (a.paidSom ?? 0) > 0 && (a.paidSom ?? 0) >= a.chargeSom
  return (
    <div className="payment">
      <p className="payment-done">
        <span>{a.paidSom === 0 && !a.chargeSom ? (a.freeReason === 'PREPAID' ? '✅ Оплачено заранее' : '🎁 Бесплатно')
          : allInDebt ? `Всё в долг · ${somText(a.chargeSom ?? 0)}`
          : fullyPaid ? `✅ Оплачено ${somText(a.paidSom ?? 0)}${split || !a.paymentMethod ? '' : ` · ${methodName(a.paymentMethod)}`}`
          : a.chargeSom != null && !(a.discount && (a.paidSom ?? 0) >= a.chargeSom) ? `${somText(a.paidSom ?? 0)} из ${somText(a.chargeSom)}`
          : split ? somText(a.paidSom ?? 0) : `${somText(a.paidSom ?? 0)} · ${methodName(a.paymentMethod)}`}</span>
        {!installments && <EditButton label="Изменить оплату" onClick={() => setView('edit')} />}
      </p>
      {a.paidSom === 0 && !allInDebt && a.freeComment && <p className="hint small payment-note">{a.freeComment}</p>}
      {a.discount && (
        <p className="payment-discount" aria-label="Скидка">
          🏷 {discountText(a.discount)} · {reasonText(a.discount.reason)}{a.discount.comment ? ` — ${a.discount.comment}` : ''}
          <span className="hint"> (цена {somText(a.discount.priceSom)})</span>
        </p>
      )}
      <EarningsGain a={a} me={me} />
      {installments && <p className="hint small">Есть доплаты — сумму меняют доплатой; ошиблись в платеже — напишите в техподдержку.</p>}
      {debt ? <p className={`tone-${debt.tone} payment-debt`}>{debt.text}</p>
        : a.chargeSom != null && !fullyPaid ? <p className="tone-ok">✅ Оплачено полностью</p> : null}
      {shown.length > 1 && (
        <p className="hint payment-history">
          {split ? shown.map((e) => `${methodName(e.method)} ${somText(e.amountSom)}`).join(' + ')
            : shown.map((e) => `${e.paidAt ? shortDate(e.paidAt) : ''} — ${somText(e.amountSom)}, ${methodName(e.method)}`).join(' · ')}
        </p>
      )}
      {a.depositStatus === 'RECEIVED' && a.chargeSom == null && (
        <button type="button" className={mainClass} onClick={() => setView('rest')}>Указать стоимость и принять остаток</button>
      )}
      {debt && !mainOutside && <button type="button" className={mainClass} data-pay-main onClick={() => setView('extra')}>Принять доплату</button>}
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

function MethodButtons({ value, onChange, label = 'Как заплатили', advance = 0 }: {
  value: Method; onChange: (m: Method) => void; label?: string
  /** Остаток аванса: больше 0 — ещё кнопка «С аванса · …» */
  advance?: number
}) {
  const options: [Method, string][] = advance > 0 ? [...METHODS, ['ADVANCE', `С аванса · ${somText(advance)}`]] : METHODS
  return (
    <div className="segments wrap" role="group" aria-label={label}>
      {options.map(([code, name]) => (
        <button key={code} type="button" aria-pressed={value === code} onClick={() => onChange(code)}>{name}</button>
      ))}
    </div>
  )
}

function fieldError(e: { fieldErrors: Record<string, string>; message: string } | null): string {
  if (!e) return ''
  const f = e.fieldErrors
  return f.amountSom ?? f.method ?? f.chargeSom ?? f.priceSom ?? f.discount ?? f.discountReason ?? f.discountComment ?? f.dueOn
    ?? f.freeReason ?? f.freeComment ?? e.message
}

/**
 * Цена из прайса — одним списком, а не кнопками на полэкрана. Выбрали — сумма в поле; выбрали ещё
 * одну — прибавится (лечение + пломба). Сумму в поле можно поправить руками.
 */
function PriceChips({ onPick }: { onPick: (price: number, add: boolean) => void }) {
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 10 * 60_000 })
  const [picked, setPicked] = useState<string[]>([])
  const list = (services.data ?? []).filter((s) => s.active && s.priceSom != null)
  // Прайс длинный — сверху «Часто», дальше разделы; поиск в списке — с 9 пунктов (Select)
  const popularIds = usePopularServices(list.length > 8)
  if (!list.length) return null
  return (
    <div className="price-pick">
      <Select collapsible aria-label="Цена из прайса" value="" onChange={(e) => {
        const s = list.find((x) => String(x.id) === e.target.value)
        if (!s) return
        onPick(s.priceSom!, picked.length > 0)
        setPicked([...picked, s.name])
      }}>
        <option value="">{picked.length ? '＋ Прибавить ещё услугу…' : 'Выбрать из прайса…'}</option>
        {serviceOptions(list, popularIds, (s) => `${serviceEmoji(s.name)} ${s.name} · ${somText(s.priceSom!)}`)}
      </Select>
      {picked.length > 0 && <p className="hint small">Из прайса: {picked.join(' + ')}</p>}
    </div>
  )
}

/**
 * Оплата не отмечена — одной строкой: «Принять оплату» раскрывает форму, «Бесплатно» сразу отмечает
 * приём без оплаты (стоимость 0) — некоторым пациентам врач делает бесплатно. «Оплачено заранее» —
 * тоже 0 сом в кассу этого дня (деньги уже получены и учтены раньше, например на прошлом визите), но
 * приём показывается оплаченным; комментарий — по желанию («оплатил 12.10 вместе с лечением»).
 */
function Unpaid({ a, onPay, primary }: { a: Appointment; onPay?: () => void; primary: boolean }) {
  const action = useAppointmentAction(a)
  const [prepaid, setPrepaid] = useState(false)
  const [note, setNote] = useState('')
  const free = () => void ask('Отметить приём бесплатным? В кассу он попадёт с суммой 0 сом.', { ok: 'Бесплатно' })
    .then((ok) => ok && action.mutate({ kind: 'payment', body: { amountSom: 0, method: 'CASH', chargeSom: 0, freeReason: 'FREE' } }))
  const savePrepaid = () => void ask('Отметить приём оплаченным заранее? В кассу сегодня ничего не добавится — деньги уже учтены раньше.',
    { ok: 'Оплачено заранее' })
    .then((ok) => ok && action.mutate({
      kind: 'payment',
      body: { amountSom: 0, method: 'CASH', chargeSom: 0, freeReason: 'PREPAID', freeComment: note.trim() || undefined },
    }))
  return (
    <div className="payment payment-unpaid">
      <span className="payment-unpaid-text"><span aria-hidden="true">💳</span> Оплата не отмечена</span>
      {!prepaid && (
        <>
          {/* Частое — первым: «Принять оплату» (на телефоне — в нижней панели), редкое — ссылками ниже */}
          {onPay && <button type="button" className={primary ? 'btn primary' : 'btn'} data-pay-main disabled={action.isPending} onClick={onPay}>Принять оплату</button>}
          <span className="payment-unpaid-links">
            <button type="button" className="link" disabled={action.isPending} onClick={free}>Бесплатно</button>
            <button type="button" className="link" disabled={action.isPending} onClick={() => setPrepaid(true)}>Оплачено заранее</button>
          </span>
        </>
      )}
      {prepaid && (
        <form className="pay-form" aria-label="Оплачено заранее" onSubmit={(e) => { e.preventDefault(); savePrepaid() }}>
          <p className="hint small">Деньги уже получены раньше — в кассу этого дня ничего не добавится, приём будет оплаченным.</p>
          <label className="field"><span>Комментарий (можно не писать)</span>
            <input value={note} maxLength={200} autoComplete="off" autoFocus placeholder="Оплатил 12.10 вместе с лечением"
              onChange={(e) => setNote(e.target.value)} /></label>
          <button type="submit" className="btn primary" disabled={action.isPending}>Отметить «Оплачено заранее»</button>
          <button type="button" className="link" onClick={() => setPrepaid(false)}>Отмена</button>
        </form>
      )}
      {action.error && <p className="error" role="alert">{fieldError(action.error)}</p>}
    </div>
  )
}

/** Как заплатил: один способ или «разными» — тогда сумма по каждому. */
type How = Method | 'SPLIT'
const HOW: [How, string][] = [...METHODS, ['SPLIT', 'Разными способами']]
type Split = Record<Method, string>
const NO_SPLIT: Split = { CASH: '', TRANSFER: '', CARD: '', ADVANCE: '' }
const SPLIT_LABEL: Record<Method, string> = { CASH: 'Наличными, сом', TRANSFER: 'Переводом, сом', CARD: 'Картой, сом', ADVANCE: 'С аванса, сом' }

/**
 * Оплата приёма по шагам — как говорят на кассе:
 * 1) сколько стоит приём (цены услуг кнопками, ещё раз — прибавить);
 * 2) заплатил всё сразу или часть — тогда сколько сейчас, остальное долгом (и до какого числа);
 * 3) чем заплатил: наличные, перевод, карта или «разными способами» — сумма по каждому.
 * Одна сумма вводится один раз: «всё сразу» — оплачено = стоимость; части считаются от «заплатил».
 */
function PayForm({ a, me, billOnly, parts: initialParts, spentHere = 0, onCancel }: {
  a: Appointment
  me: Me
  billOnly: boolean
  parts: Entry[]
  /** Этот приём уже оплачен с аванса на столько — при «Изменить» доступно снова */
  spentHere?: number
  onCancel?: () => void
}) {
  const action = useAppointmentAction(a)
  // «С аванса» (V243): кнопка способа и поле в «Разными способами» — когда на авансе пациента (семьи) что-то есть
  const advance = useAdvanceFor(a, me, spentHere)
  const splitMethods: [Method, string][] = advance > 0 || initialParts.some((e) => e.method === 'ADVANCE')
    ? [...METHODS, ['ADVANCE', 'С аванса']] : METHODS
  const how3: [How, string][] = advance > 0 ? [...METHODS, ['ADVANCE', `С аванса · ${somText(advance)}`], ['SPLIT', 'Разными способами']] : HOW
  const hadDebt = a.debtSom > 0
  // Со скидкой «стоимость» в форме — цена до скидки, к оплате — её посчитанный остаток
  const [cost, setCost] = useState(String(a.discount?.priceSom ?? a.chargeSom ?? a.paidSom ?? a.servicePriceSom ?? ''))
  const [discount, setDiscount] = useState<DiscountDraft | null>(() => draftOf(a.discount))
  const policy = useDiscountPolicy()
  const [whole, setWhole] = useState(!hadDebt)
  const [paidNow, setPaidNow] = useState(hadDebt ? String(a.paidSom ?? '') : '')
  const [due, setDue] = useState(a.dueOn ?? '')
  const startSplit = initialParts.length > 1
  const [how, setHow] = useState<How>(startSplit ? 'SPLIT' : a.paymentMethod ?? 'CASH')
  const [split, setSplit] = useState<Split>(() => {
    if (!startSplit) return NO_SPLIT
    const sums = { ...NO_SPLIT }
    for (const e of initialParts) if (e.method) sums[e.method] = String((Number(sums[e.method]) || 0) + e.amountSom)
    return sums
  })
  const [problem, setProblem] = useState('')
  const toCashier = me.hasReception && !me.reception

  const priceNum = cost === '' ? null : Number(cost)
  const off = draftSom(priceNum, discount)
  // К оплате: цена минус скидка (подсказка — итог считает и проверяет сервер)
  const costNum = priceNum == null ? null : Math.max(priceNum - off, 0)
  const paid = whole ? costNum : paidNow === '' ? null : Number(paidNow)
  const rest = costNum != null && paid != null ? costNum - paid : null
  const splitSum = splitMethods.reduce((sum, [m]) => sum + (Number(split[m]) || 0), 0)
  // «Сейчас ничего — всё в долг»: шаг «Чем заплатил» не нужен
  const nothingNow = !whole && paid === 0

  const pick = (price: number, add: boolean) => setCost(String(add ? (Number(cost) || 0) + price : price))

  const save = () => {
    setProblem('')
    if (priceNum == null || priceNum < 1) {
      setProblem('Впишите, сколько стоит приём')
      return
    }
    const discountError = draftProblem(priceNum, discount, policy.data)
    if (discountError) {
      setProblem(discountError)
      return
    }
    if (costNum == null) return
    if (!whole) {
      // 0 — «сейчас ничего, всё в долг»
      if (paid == null || paid < 0) {
        setProblem('Впишите, сколько заплатил сейчас')
        return
      }
      if (paid >= costNum) {
        setProblem('Заплатил всё — выберите «Всё сразу»')
        return
      }
    }
    const amount = paid!
    // Подсказка до сервера (он проверит сам): с аванса — не больше остатка
    const fromAdvance = how === 'ADVANCE' ? amount : how === 'SPLIT' ? Number(split.ADVANCE) || 0 : 0
    if (!nothingNow && fromAdvance > advance) {
      setProblem(advance > 0 ? `На авансе только ${somText(advance)} — остальное другим способом («Разными способами»)` : 'На авансе нет денег')
      return
    }
    let parts: { amountSom: number; method: Method }[] | undefined
    let method: Method = how === 'SPLIT' ? 'CASH' : how
    if (how === 'SPLIT' && !nothingNow) {
      parts = splitMethods.filter(([m]) => Number(split[m]) > 0).map(([m]) => ({ amountSom: Number(split[m]), method: m }))
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
    // Скидка: цена до скидки и сама скидка — стоимость со скидкой сервер посчитает сам (chargeSom не шлём)
    const withDiscount = discount ? {
      priceSom: priceNum,
      discount: {
        ...(discount.kind === 'percent' ? { percent: Number(discount.value) } : { som: Number(discount.value) }),
        reason: discount.reason || undefined,
        comment: discount.comment.trim() || undefined,
      },
    } : {}
    // Счёт с кассы, а пришло меньше — остаток долгом (стоимость = сумма счёта)
    const charge = discount ? undefined : !whole || (a.chargeSom != null && amount < a.chargeSom) ? costNum : undefined
    action.mutate({
      kind: 'payment',
      // Всё в долг — денег не было: способ не отправляем (сервер его и не спросит)
      body: nothingNow ? { amountSom: 0, chargeSom: discount ? undefined : costNum, dueOn: due || undefined, ...withDiscount }
        : { amountSom: amount, method, chargeSom: charge, dueOn: !whole && due ? due : undefined, parts, ...withDiscount },
    })
  }
  const unmark = async () => {
    if (!await ask(`Снять отметку оплаты ${somText(a.paidSom ?? 0)}? Сумма пропадёт из «Кассы» и отчёта.`)) return
    action.mutate({ kind: 'payment', body: { method: a.paymentMethod ?? 'CASH' } })
  }
  const bill = () => {
    setProblem('')
    if (priceNum == null || priceNum < 1) {
      setProblem('Впишите, сколько вышло за приём')
      return
    }
    // На кассу — цена без скидки: скидку даёт тот, кто принимает оплату
    action.mutate({ kind: 'bill', body: { chargeSom: priceNum } })
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
      {/* Сумма и способ подставлены заранее — без этой строки казалось, что оплата уже отмечена */}
      <p className="pay-unsaved" role="note">Оплата ещё не сохранена — проверьте сумму и нажмите кнопку «Сохранить» ниже</p>
      <div className="pay-step">
        <span className="pay-step-n" aria-hidden="true">1</span>
        <div className="pay-step-body">
          {costField(discount ? 'Цена приёма до скидки, сом' : 'Стоимость приёма, сом')}
          <PriceChips onPick={pick} />
          <DiscountField price={priceNum} value={discount} onChange={setDiscount} policy={policy.data} />
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
                <input type="number" min={0} inputMode="numeric" value={paidNow} onChange={(e) => setPaidNow(e.target.value)} /></label>
              {!nothingNow && (
                <button type="button" className="link" onClick={() => setPaidNow('0')}>Сейчас ничего — всё в долг</button>
              )}
              {rest != null && rest > 0 && <p className="pay-rest">Остальное потом: <b className="num">{somText(rest)}</b> — станет долгом пациента</p>}
              <label className="field"><span>Доплатит до (можно не указывать)</span>
                <DateInput min={todayIn()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
            </div>
          )}
        </div>
      </div>

      {!nothingNow && <div className="pay-step">
        <span className="pay-step-n" aria-hidden="true">3</span>
        <div className="pay-step-body">
          <span className="pay-step-title">Чем заплатил</span>
          <div className="segments wrap" role="group" aria-label="Как заплатили">
            {how3.map(([code, name]) => (
              <button key={code} type="button" aria-pressed={how === code} onClick={() => setHow(code)}>{name}</button>
            ))}
          </div>
          {how === 'SPLIT' && (
            <div className="payment-split">
              {splitMethods.map(([m]) => (
                <label key={m} className="field"><span>{m === 'ADVANCE' ? `${SPLIT_LABEL[m]} (есть ${somText(advance)})` : SPLIT_LABEL[m]}</span>
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
      </div>}

      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn primary" disabled={action.isPending}>
        {nothingNow ? `Сохранить — всё в долг${costNum ? ` · ${somText(costNum)}` : ''}`
          : `${waiting ? 'Принять оплату' : 'Сохранить оплату'}${paid ? ` · ${somText(paid)}` : ''}`}</button>
      {cashierButton && <p className="hint small">Пациент платит в регистратуре? Впишите стоимость и передайте на кассу:</p>}
      {cashierButton}
      {a.paidSom != null && <button type="button" className="link danger-link" disabled={action.isPending} onClick={unmark}>Снять отметку оплаты</button>}
      {cancel}
    </form>
  )
}

/** Доплата долга: сумма (не больше долга) и способ. */
function ExtraForm({ a, me, onCancel }: { a: Appointment; me: Me; onCancel: () => void }) {
  const action = useAppointmentAction(a)
  const advance = useAdvanceFor(a, me, 0)
  const [amount, setAmount] = useState(String(a.debtSom))
  // Прошлый платёж был с аванса, а он кончился — по умолчанию наличные
  const [method, setMethod] = useState<Method>(a.paymentMethod && a.paymentMethod !== 'ADVANCE' ? a.paymentMethod : 'CASH')
  return (
    <form className="pay-form" aria-label="Доплата" onSubmit={(e) => {
      e.preventDefault()
      action.mutate({ kind: 'extra', body: { amountSom: amount === '' ? undefined : Number(amount), method } })
    }}>
      <label className="field"><span>Доплата (долг {somText(a.debtSom)})</span>
        <input type="number" min={1} max={a.debtSom} inputMode="numeric" aria-label="Доплата, сом" autoFocus
          value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <MethodButtons value={method} onChange={setMethod} advance={advance} />
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
