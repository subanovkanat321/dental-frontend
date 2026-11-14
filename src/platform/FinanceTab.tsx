import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { Donut } from '../lib/Donut'
import { shortDate, somText, todayIn } from '../lib/time'
import { Segments } from '../layout/Segments'
import { DateInput } from '../layout/DateInput'
import { EmptyState } from '../layout/EmptyState'
import { HelpHint } from '../help/HelpHint'
import { MonthPicker } from '../layout/MonthPicker'
import { Loading } from '../layout/Loading'
import { TopupsBlock } from './TopupsBlock'
import { HeadTools } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

type Finance = Schemas['PlatformFinanceFinance']
type Line = Schemas['PlatformFinanceLine']
type Expense = Schemas['PlatformExpensesExpense']
type MonthTotal = Schemas['PlatformFinanceMonthTotal']
type Due = Schemas['PlatformFinanceDue']
type Mark = Schemas['PlatformExpensesMark']

const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const shortMonth = (m: string) => MONTH_SHORT.format(new Date(`${m}-01T00:00:00Z`)).replace('.', '')
const longMonth = (m: string) => MONTH_LONG.format(new Date(`${m}-01T00:00:00Z`)).replace(' г.', '')

/** Прибыль со знаком: −1 200 сом — убыток. */
const signed = (som: number) => (som < 0 ? `−${somText(-som)}` : somText(som))
const tone = (som: number) => (som < 0 ? 'tone-bad' : som > 0 ? 'tone-ok' : undefined)

/** 1.5 → «1,5»: цена SMS и курс — как пишут у нас. */
const decimal = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)

type Period = 'month' | 'quarter' | 'year' | 'all' | 'custom'

const PERIODS: [Period, string][] = [['month', 'Месяц'], ['quarter', 'Квартал'], ['year', 'Год'], ['all', 'Всё время'], ['custom', 'Свой период']]
const QUARTERS = ['I', 'II', 'III', 'IV']

/** '2026-11' + 1 → '2026-12'. */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const i = y! * 12 + m! - 1 + by
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

/** Первый месяц квартала: '2026-11' → '2026-10'. */
const quarterStart = (m: string) => `${m.slice(0, 4)}-${String(Math.floor((Number(m.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}`

/** «ноябрь 2026», «январь — март 2026», «декабрь 2025 — январь 2026». */
function rangeText(from: string, to: string): string {
  if (from === to) return longMonth(from)
  if (from.slice(0, 4) === to.slice(0, 4)) return `${MONTH_NAME.format(new Date(`${from}-01T00:00:00Z`))} — ${longMonth(to)}`
  return `${longMonth(from)} — ${longMonth(to)}`
}
const MONTH_NAME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long' })

/**
 * «Платформа → Финансы» (только владелец платформы, сервер отвечает 403 остальным): доходы — оплаты
 * клиник за подписку, расходы — ИИ и SMS сами (из учёта токенов и журнала SMS) плюс ручные статьи
 * (Claude, реклама, сервер…; разовые и «каждый месяц»), прибыль. Период — месяц, квартал, год, всё
 * время или свой (с — по); за период больше месяца — график и таблица по месяцам. Считает сервер
 * (/api/platform/finance) — здесь только показываем и вводим ручные расходы.
 *
 * «Каждый месяц» — шаблон, а не факт: с ноября 2026 (factFrom) в расход месяца попадает только
 * отмеченная оплата. Сверху — «Ожидаются в этом месяце» (оплачено / не в этом месяце), у итогов —
 * «ещё ожидается» (прогноз, в расход не входит).
 */
export function FinanceTab() {
  const current = todayIn().slice(0, 7)
  const [period, setPeriod] = useState<Period>('month')
  const [month, setMonth] = useState(current)
  const [from, setFrom] = useState(shiftMonth(current, -2))
  const [to, setTo] = useState(current)
  const params = period === 'month' ? { month } : period === 'quarter' || period === 'year' ? { period, month }
    : period === 'all' ? { period } : { period, from, to }
  const query = useQuery<Finance, ApiError>({
    queryKey: ['platform-finance', params],
    queryFn: () => unwrap(api.GET('/api/platform/finance', { params: { query: params } })),
    placeholderData: (previous) => previous,
  })
  const f = query.data
  const single = period === 'month'
  const scope = single ? 'за месяц' : 'за период'
  const openMonth = (m: string) => { setMonth(m); setPeriod('month') }
  const pending = f?.pendingSom ?? 0
  return (
    <>
      {f && (f.due?.length ?? 0) > 0 && <DueBlock due={f.due ?? []} current={current} rate={f.settings?.lastUsdRate} />}
      <section className="card-block" aria-label="Итог периода">
        {/* Период — в строку шапки «Платформы» */}
        <HeadTools>
          <Segments className="fin-periods" label="Период" value={period} onChange={setPeriod} options={PERIODS.map(([key, title]) => ({ value: key, label: title }))} />
          {period === 'month' && <MonthPicker label="Месяц финансов" value={month} max={current} onChange={setMonth} />}
          {period === 'quarter' && (
            <Stepper label="Квартал" text={`${QUARTERS[Math.floor((Number(month.slice(5, 7)) - 1) / 3)]} квартал ${month.slice(0, 4)}`}
              onPrev={() => setMonth(shiftMonth(quarterStart(month), -3))}
              onNext={shiftMonth(quarterStart(month), 3) > current ? undefined : () => setMonth(shiftMonth(quarterStart(month), 3))} />
          )}
          {period === 'year' && (
            <Stepper label="Год" text={`${month.slice(0, 4)} год`} onPrev={() => setMonth(`${Number(month.slice(0, 4)) - 1}-12`)}
              onNext={Number(month.slice(0, 4)) >= Number(current.slice(0, 4)) ? undefined
                : () => setMonth(Number(month.slice(0, 4)) + 1 === Number(current.slice(0, 4)) ? current : `${Number(month.slice(0, 4)) + 1}-12`)} />
          )}
          {period === 'custom' && (
            <div className="fin-range">
              <span className="hint">с</span>
              <MonthPicker label="Первый месяц" value={from} max={current} onChange={(m) => { setFrom(m); if (m > to) setTo(m) }} />
              <span className="hint">по</span>
              <MonthPicker label="Последний месяц" value={to} max={current} onChange={(m) => { setTo(m); if (m < from) setFrom(m) }} />
            </div>
          )}
        </HeadTools>
        {query.error && <p className="error" role="alert">{query.error.message}</p>}
        {query.isPending ? <Loading /> : f && (
          <>
            {!single && f.from && f.to && <p className="hint fin-scope" aria-live="polite">{rangeText(f.from, f.to)}{f.to === current ? ' (по текущий месяц)' : ''}</p>}
            <div className="survey-tiles fin-tiles">
              <div className="survey-tile"><span className="hint">Доход</span><b className="num" aria-label={`Доход ${scope}`}>{somText(f.incomeSom)}</b></div>
              <div className="survey-tile"><span className="hint">Расход<HelpHint title="Расход">Расход и прибыль — только оплаченное: «каждый месяц» без отметки «Оплачено» не считается.
                Пополнения ИИ и SMS в расход не входят — ИИ и SMS считаются по использованию.</HelpHint></span><b className="num" aria-label={`Расход ${scope}`}>{somText(f.expenseSom)}</b>
                {pending > 0 && <span className="hint small fin-pending-note">ещё ожидается: <span className="num nowrap">{somText(pending)}</span></span>}
                {(f.topups?.length ?? 0) > 0 && <span className="hint small fin-pending-note">пополнения: <span className="num nowrap">{somText(f.topupSom)}</span> — не в расходе</span>}</div>
              <div className="survey-tile hero"><span className="hint">{f.profitSom < 0 ? 'Убыток' : 'Прибыль'}</span>
                <b className={`num ${tone(f.profitSom) ?? ''}`.trim()} aria-label={`Прибыль ${scope}`}>{signed(f.profitSom)}</b>
                {pending > 0 && <span className="hint small fin-pending-note">если оплатить всё ожидаемое: <span className="num nowrap">{signed(f.profitSom - pending)}</span></span>}</div>
            </div>
          </>
        )}
      </section>
      {f && <TopupsBlock f={f} single={single} />}
      {f && <ExpensesBlock f={f} single={single} />}
      {f && !single && (f.months?.length ?? 0) > 1 && <MonthsBlock months={f.months ?? []} onPick={openMonth} />}
      {f && <IncomeBlock f={f} single={single} />}
      {f && single && <HistoryBlock history={f.history ?? []} month={month} onPick={setMonth} />}
      {f && <SmsPriceForm key={String(f.settings?.smsPriceSom ?? '')} price={f.settings?.smsPriceSom} />}
    </>
  )
}

/** «октябрь» — для «не отмечено за октябрь». */
const monthName = (m: string) => MONTH_NAME.format(new Date(`${m}-01T00:00:00Z`))

/** «1 750 сом» или «$20 × 87,5 ≈ 1 750 сом» — сумма шаблона по умолчанию. */
const dueAmount = (d: Due) => (d.amountUsd != null ? `$${decimal(d.amountUsd)} × ${decimal(d.usdRate ?? 0)} ≈ ${somText(d.amountSom)}` : somText(d.amountSom))

/**
 * «Ожидаются в этом месяце»: шаблоны «каждый месяц» без отметки — текущий месяц и прошлые
 * неотмеченные («не отмечено за октябрь»). «Оплачено» — подтвердить сумму и день; «Не в этом
 * месяце» — пропущено, 0. Пока не отмечено, в расход не входит.
 */
function DueBlock({ due, current, rate }: { due: Due[]; current: string; rate?: number }) {
  const client = useQueryClient()
  const [paying, setPaying] = useState<string | null>(null)
  const key = (d: Due) => `${d.expenseId}-${d.month}`
  const skip = useMutation<Mark, ApiError, Due>({
    mutationFn: (d) => unwrap(api.PUT('/api/platform/finance/expenses/{id}/months/{month}', {
      params: { path: { id: d.expenseId, month: d.month! } }, body: { status: 'SKIPPED' },
    })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-finance'] }),
  })
  const overdue = due.filter((d) => d.overdue).length
  return (
    <section className="card-block fin-due" aria-label="Ожидаются в этом месяце">
      <h2>Ожидаются в этом месяце<HelpHint title="Ожидаются в этом месяце">Подписки «каждый месяц». В расход попадут, когда отметите оплату.</HelpHint>
        {overdue > 0 && <span className="chip small s-wait">есть неотмеченные за прошлые месяцы</span>}</h2>
      {skip.error && <p className="error" role="alert">{skip.error.message}</p>}
      <ul className="fin-entries" aria-label="Ожидаемые оплаты">
        {due.map((d) => (
          <li key={key(d)} className={d.overdue ? 'fin-due-late' : undefined}>
            <div className="fin-entry">
              <div>
                <b>{d.category}</b> — <span className="num nowrap">{dueAmount(d)}</span>
                {d.overdue && <span className="chip small s-wait">не отмечено за {monthName(d.month ?? '')}</span>}
                <div className="hint small">{d.month === current ? `обычно до ${d.day}-го числа` : `${longMonth(d.month ?? '')} · обычно до ${d.day}-го числа`}</div>
              </div>
              {paying !== key(d) && (
                <div className="fin-due-actions">
                  <button type="button" className="btn small" aria-label={`Оплачено: ${d.category}, ${longMonth(d.month ?? '')}`}
                    onClick={() => setPaying(key(d))}>Оплачено</button>
                  <button type="button" className="btn ghost small" disabled={skip.isPending}
                    aria-label={`Не в этом месяце: ${d.category}, ${longMonth(d.month ?? '')}`} onClick={() => skip.mutate(d)}>Не в этом месяце</button>
                </div>
              )}
            </div>
            {paying === key(d) && <PayForm due={d} rate={rate} onDone={() => setPaying(null)} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Подтвердить оплату месяца: сумма — по умолчанию из шаблона (в его валюте), курс — шаблона или
 * последний, день — сегодня (для прошлого месяца — его последний день). Сумму в сомах считает сервер.
 */
function PayForm({ due: d, rate, onDone }: { due: Due; rate?: number; onDone: () => void }) {
  const client = useQueryClient()
  const today = todayIn()
  const lastDay = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y!, mo, 0)).getUTCDate()).padStart(2, '0')}` }
  const [usd, setUsd] = useState(d.amountUsd != null)
  const [amount, setAmount] = useState(String(d.amountUsd ?? d.amountSom ?? ''))
  const [usdRate, setUsdRate] = useState(String(d.usdRate ?? rate ?? ''))
  const [paidOn, setPaidOn] = useState(today.startsWith(d.month ?? '') || !d.month ? today : lastDay(d.month))
  const save = useMutation<Mark, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/finance/expenses/{id}/months/{month}', {
      params: { path: { id: d.expenseId, month: d.month! } },
      body: { status: 'PAID', paidOn, ...(usd ? { amountUsd: Number(amount), usdRate: Number(usdRate) } : { amountSom: Number(amount) }) },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-finance'] })
      onDone()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const err = (k: string) => save.error?.fieldErrors[k]
  const som = usd && Number(amount) > 0 && Number(usdRate) > 0 ? Math.round(Number(amount) * Number(usdRate)) : null
  const known = ['amountSom', 'amountUsd', 'usdRate', 'paidOn']
  return (
    <form className="form sub-form fin-form" aria-label={`Оплата: ${d.category}`} onSubmit={submit}>
      <div className="segments" role="group" aria-label="Валюта оплаты">
        <button type="button" aria-pressed={!usd} onClick={() => setUsd(false)}>В сомах</button>
        <button type="button" aria-pressed={usd} onClick={() => setUsd(true)}>В долларах</button>
      </div>
      <div className="fin-row">
        <div className="field">
          <label className="field"><span>{usd ? 'Оплачено, $' : 'Оплачено, сом'}</span>
            <input type="number" min={usd ? 0.01 : 1} step={usd ? '0.01' : '1'} inputMode={usd ? 'decimal' : 'numeric'} required autoFocus value={amount}
              onChange={(e) => { save.reset(); setAmount(e.target.value) }} /></label>
          {(err('amountSom') ?? err('amountUsd')) && <p className="error">{err('amountSom') ?? err('amountUsd')}</p>}
        </div>
        {usd && (
          <div className="field">
            <label className="field"><span>Курс: сомов за $1</span>
              <input type="number" min={0.01} step="0.01" inputMode="decimal" required value={usdRate}
                onChange={(e) => { save.reset(); setUsdRate(e.target.value) }} /></label>
            {err('usdRate') && <p className="error">{err('usdRate')}</p>}
          </div>
        )}
        <div className="field">
          <label className="field"><span>День оплаты</span>
            <DateInput value={paidOn} required max={today} onChange={(e) => { save.reset(); setPaidOn(e.target.value) }} /></label>
          {err('paidOn') && <p className="error">{err('paidOn')}</p>}
        </div>
      </div>
      {som != null && <p className="hint small" aria-live="polite">≈ {somText(som)} — точную сумму посчитает сервер</p>}
      {save.error && !known.some((k) => save.error?.fieldErrors[k]) && <p className="error" role="alert">{save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить оплату</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}

/** «‹ IV квартал 2026 ›» — тот же вид, что выбор месяца; onNext нет — дальше нельзя (будущее). */
function Stepper({ label, text, onPrev, onNext }: { label: string; text: string; onPrev: () => void; onNext?: () => void }) {
  return (
    <div className="month-picker" role="group" aria-label={label}>
      <button type="button" className="mp-step" aria-label={`Предыдущий: ${label.toLowerCase()}`} onClick={onPrev}>‹</button>
      <span className="mp-current mp-static" aria-live="polite">{text}</span>
      <button type="button" className="mp-step" aria-label={`Следующий: ${label.toLowerCase()}`} disabled={!onNext} onClick={onNext}>›</button>
    </div>
  )
}

/** Подпись строки расходов: что за число и откуда. */
function lineNote(l: Line, price?: number): string {
  if (l.key === 'AI') return l.count ? `${l.count} запросов к ИИ · как во вкладке «Расход ИИ»` : 'запросов к ИИ не было'
  if (l.key === 'SMS') {
    if (l.needsPrice) return `${l.count} SMS · укажите цену SMS ниже`
    return `${l.count} SMS × ${decimal(price ?? 0)} сом`
  }
  return l.count > 1 ? `записей: ${l.count}` : ''
}

function ExpensesBlock({ f, single }: { f: Finance; single: boolean }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const lines = f.expenses ?? []
  const entries = f.entries ?? []
  const marks = f.marks ?? []
  return (
    <section className="card-block" aria-label="Расходы">
      <div className="block-head">
        <h2>Расходы</h2>
        {!adding && <button type="button" className="btn primary small" onClick={() => { setAdding(true); setEditing(null) }}>Добавить расход</button>}
      </div>
      {/* Структура расходов месяца — бублик; ниже те же статьи списком с пометками «считается само» */}
      <Donut parts={lines.filter((l) => !l.needsPrice && l.som > 0).map((l) => ({ key: l.key ?? l.label ?? '', name: l.label ?? '', value: l.som }))}
        label={single ? 'Структура расходов за месяц' : 'Структура расходов за период'} format={somText} center={somText(f.expenseSom)}
        caption={single ? 'расходы месяца' : 'расходы за период'} empty={single ? 'Расходы за этот месяц — 0 сом.' : 'Расходы за этот период — 0 сом.'} />
      <dl className="net-lines fin-lines" aria-label="Расходы по статьям">
        {lines.map((l) => (
          <div key={l.key}>
            <dt>{l.label}
              {l.auto && <span className="chip small s-quiet">считается само</span>}
              {lineNote(l, f.settings?.smsPriceSom) && (
                <span className={`hint small${l.needsPrice ? ' tone-wait' : ''}`}> · {lineNote(l, f.settings?.smsPriceSom)}</span>
              )}
            </dt>
            <dd className="num">{l.needsPrice ? '—' : somText(l.som)}</dd>
          </div>
        ))}
        <div className="net-total"><dt>Всего расходов</dt><dd className="num">{somText(f.expenseSom)}</dd></div>
      </dl>
      {adding && (
        <ExpenseForm categories={f.categories ?? []} rate={f.settings?.lastUsdRate} month={f.to ?? f.month ?? ''} onDone={() => setAdding(false)} />
      )}
      <h3>Записи вручную</h3>
      {entries.length === 0 ? (
        <EmptyState compact title={single ? 'В этом месяце ручных расходов нет' : 'За этот период ручных расходов нет'}>
          Сервер, домен, реклама — «Добавить расход»; подписку — «каждый месяц».
        </EmptyState>
      ) : (
        <ul className="fin-entries" aria-label={single ? 'Ручные расходы месяца' : 'Ручные расходы периода'}>
          {entries.map((x) => (
            <li key={x.id}>
              {editing === x.id ? (
                <ExpenseForm expense={x} categories={f.categories ?? []} rate={f.settings?.lastUsdRate} month={f.to ?? f.month ?? ''}
                  onDone={() => setEditing(null)} />
              ) : (
                <div {...rowOpen(() => { setEditing(x.id); setAdding(false) }, 'fin-entry')}>
                  <div>
                    <b>{x.category}</b>
                    {x.monthly && <span className="chip small s-quiet">каждый месяц</span>}
                    <div className="hint small">{entryNote(x)}</div>
                    {x.monthly && <MarkList marks={marks.filter((k) => k.expenseId === x.id)} category={x.category ?? ''} />}
                  </div>
                  <span className="num strong nowrap">{somText(x.amountSom)}{x.monthly && <span className="hint small"> / мес</span>}</span>
                  <button type="button" className="btn ghost small" aria-label={`Исправить: ${x.category}`}
                    onClick={() => { setEditing(x.id); setAdding(false) }}>Исправить</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Отметки шаблона за месяцы периода: «ноябрь 2026: оплачено 1 848 сом · 2 нояб.» — снять, если ошиблись. */
function MarkList({ marks, category }: { marks: Mark[]; category: string }) {
  const client = useQueryClient()
  const unmark = useMutation<unknown, ApiError, Mark>({
    mutationFn: (k) => unwrap(api.DELETE('/api/platform/finance/expenses/{id}/months/{month}', {
      params: { path: { id: k.expenseId, month: k.month! } },
    })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-finance'] }),
  })
  if (marks.length === 0) return null
  return (
    <ul className="fin-marks" aria-label={`Отметки: ${category}`}>
      {marks.map((k) => (
        <li key={k.month}>
          <span className="hint small">{longMonth(k.month ?? '')}: </span>
          {k.status === 'PAID'
            ? <span className="small">оплачено <span className="num nowrap">{somText(k.amountSom ?? 0)}</span>{k.amountUsd != null ? ` ($${decimal(k.amountUsd)} × ${decimal(k.usdRate ?? 0)})` : ''}{k.paidOn ? ` · ${shortDate(k.paidOn)}` : ''}</span>
            : <span className="small">не платили</span>}
          <button type="button" className="link small" disabled={unmark.isPending}
            aria-label={`Снять отметку: ${category}, ${longMonth(k.month ?? '')}`} onClick={() => unmark.mutate(k)}>снять</button>
        </li>
      ))}
      {unmark.error && <li className="error" role="alert">{unmark.error.message}</li>}
    </ul>
  )
}

/** «$20 × 87,5 · с 15 янв. · до 10 февр. · комментарий». */
function entryNote(x: Expense): string {
  const parts: string[] = []
  if (x.amountUsd != null) parts.push(`$${decimal(x.amountUsd)} × ${decimal(x.usdRate ?? 0)}`)
  if (x.spentOn) parts.push(x.monthly ? `с ${shortDate(x.spentOn)}` : shortDate(x.spentOn))
  if (x.monthly) parts.push(x.endedOn ? `отменён ${shortDate(x.endedOn)}` : 'пока не отменён')
  if (x.comment) parts.push(x.comment)
  return parts.join(' · ')
}

/**
 * Добавить или исправить ручной расход: статья (свои — тоже), сумма в сомах или в долларах по курсу
 * (по умолчанию — последний введённый), дата, «каждый месяц» и дата отмены. Итог в сомах — подсказка,
 * считает и хранит сервер.
 */
function ExpenseForm({ expense: x, categories, rate, month, onDone }: {
  expense?: Expense
  categories: string[]
  rate?: number
  month: string
  onDone: () => void
}) {
  const client = useQueryClient()
  const today = todayIn()
  const [category, setCategory] = useState(x?.category ?? '')
  const [usd, setUsd] = useState(x?.amountUsd != null)
  const [amount, setAmount] = useState(x ? String(x.amountUsd ?? x.amountSom ?? '') : '')
  const [usdRate, setUsdRate] = useState(String(x?.usdRate ?? rate ?? ''))
  // Новый расход — в выбранном месяце: сегодня, если месяц текущий, иначе его первое число
  const [spentOn, setSpentOn] = useState(x?.spentOn ?? (today.startsWith(month) ? today : `${month}-01`))
  const [monthly, setMonthly] = useState(x?.monthly ?? false)
  const [endedOn, setEndedOn] = useState(x?.endedOn ?? '')
  const [comment, setComment] = useState(x?.comment ?? '')
  const done = () => {
    void client.invalidateQueries({ queryKey: ['platform-finance'] })
    onDone()
  }
  const body = (): Schemas['PlatformFinanceExpenseForm'] => ({
    category: category.trim(),
    ...(usd ? { amountUsd: Number(amount), usdRate: Number(usdRate) } : { amountSom: Number(amount) }),
    spentOn,
    monthly,
    endedOn: monthly && endedOn ? endedOn : undefined,
    comment: comment.trim() || undefined,
  })
  const save = useMutation<Expense, ApiError>({
    mutationFn: () => (x
      ? unwrap(api.PUT('/api/platform/finance/expenses/{id}', { params: { path: { id: x.id } }, body: body() }))
      : unwrap(api.POST('/api/platform/finance/expenses', { body: body() }))),
    onSuccess: done,
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/finance/expenses/{id}', { params: { path: { id: x!.id } } })),
    onSuccess: done,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const error = save.error ?? remove.error
  const err = (k: string) => save.error?.fieldErrors[k]
  const som = usd && Number(amount) > 0 && Number(usdRate) > 0 ? Math.round(Number(amount) * Number(usdRate)) : null
  const known = ['category', 'amountSom', 'amountUsd', 'usdRate', 'spentOn', 'endedOn', 'comment']
  return (
    <form className="form sub-form fin-form" aria-label={x ? 'Исправить расход' : 'Новый расход'} onSubmit={submit}>
      <div className="field">
        <label className="field"><span>Статья</span>
          <input list="fin-categories" maxLength={60} required autoFocus={!x} value={category} placeholder="Например: Реклама"
            onChange={(e) => { save.reset(); setCategory(e.target.value) }} /></label>
        <datalist id="fin-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        {!x && (
          <div className="fin-cats" role="group" aria-label="Статьи">
            {categories.slice(0, 8).map((c) => (
              <button key={c} type="button" className="btn small" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
        )}
        {err('category') && <p className="error">{err('category')}</p>}
      </div>
      <div className="segments" role="group" aria-label="Валюта">
        <button type="button" aria-pressed={!usd} onClick={() => setUsd(false)}>В сомах</button>
        <button type="button" aria-pressed={usd} onClick={() => setUsd(true)}>В долларах</button>
      </div>
      <div className="fin-row">
        <div className="field">
          <label className="field"><span>{usd ? 'Сумма, $' : 'Сумма, сом'}</span>
            <input type="number" min={usd ? 0.01 : 1} step={usd ? '0.01' : '1'} inputMode={usd ? 'decimal' : 'numeric'} required value={amount}
              onChange={(e) => { save.reset(); setAmount(e.target.value) }} /></label>
          {(err('amountSom') ?? err('amountUsd')) && <p className="error">{err('amountSom') ?? err('amountUsd')}</p>}
        </div>
        {usd && (
          <div className="field">
            <label className="field"><span>Курс: сомов за $1</span>
              <input type="number" min={0.01} step="0.01" inputMode="decimal" required value={usdRate}
                onChange={(e) => { save.reset(); setUsdRate(e.target.value) }} /></label>
            {err('usdRate') && <p className="error">{err('usdRate')}</p>}
          </div>
        )}
      </div>
      {som != null && <p className="hint small" aria-live="polite">≈ {somText(som)} — точную сумму посчитает сервер</p>}
      <div className="field">
        <label className="field"><span>{monthly ? 'С какого числа' : 'Дата'}</span>
          <DateInput value={spentOn} required onChange={(e) => setSpentOn(e.target.value)} /></label>
        {err('spentOn') && <p className="error">{err('spentOn')}</p>}
      </div>
      <label className="check"><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
        Каждый месяц — подписка, сервер: напомним каждый месяц; в расход попадёт, когда отметите оплату</label>
      {monthly && x && (
        <div className="field">
          <label className="field"><span>Отменён (последний месяц с этим расходом) — пусто, если ещё платите</span>
            <DateInput value={endedOn} min={spentOn} onChange={(e) => setEndedOn(e.target.value)} /></label>
          {!endedOn && <button type="button" className="btn ghost small" onClick={() => setEndedOn(today)}>Отменить с сегодня</button>}
          {err('endedOn') && <p className="error">{err('endedOn')}</p>}
        </div>
      )}
      <div className="field">
        <label className="field"><span>Комментарий (необязательно)</span>
          <input maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
        {err('comment') && <p className="error">{err('comment')}</p>}
      </div>
      {error && !known.some((k) => save.error?.fieldErrors[k]) && <p className="error" role="alert">{error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>{x ? 'Сохранить' : 'Добавить'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
        {x && (
          <button type="button" className="btn danger" disabled={remove.isPending}
            onClick={() => void ask(x.monthly
              ? 'Удалить расход? Он пропадёт из всех месяцев. Если подписку просто отменили — укажите дату отмены. С отмеченными оплатами удалить нельзя.'
              : 'Удалить расход?').then((ok) => ok && remove.mutate())}>Удалить</button>
        )}
      </div>
    </form>
  )
}

function IncomeBlock({ f, single }: { f: Finance; single: boolean }) {
  const rows = f.income ?? []
  return (
    <section className="card-block" aria-label="Доходы по клиникам">
      <h2>Доходы по клиникам<HelpHint title="Доходы по клиникам">Оплаты подписки, отмеченные в «Клиники» → клиника → «Оплата», — по дню оплаты. Считается само.</HelpHint></h2>
      {rows.length === 0 ? (
        <EmptyState compact title={single ? 'В этом месяце оплат от клиник не было' : 'За этот период оплат от клиник не было'} />
      ) : (
        <div className="table-scroll">
          <table className="table" aria-label={single ? 'Оплаты клиник за месяц' : 'Оплаты клиник за период'}>
            <thead><tr><th>Клиника</th><th className="r">Оплат</th><th className="r">Сумма</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clinicId}>
                  <td>{r.name}</td>
                  <td className="r num">{r.payments}</td>
                  <td className="r num nowrap">{somText(r.som)}</td>
                </tr>
              ))}
              <tr className="strong"><td>Всего</td><td /><td className="r num nowrap">{somText(f.incomeSom)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const monthText = (m: MonthTotal) => `${longMonth(m.month ?? '')}: доход ${somText(m.incomeSom)}, расход ${somText(m.expenseSom)}, прибыль ${signed(m.profitSom)}${m.pendingSom > 0 ? `, ещё ожидается ${somText(m.pendingSom)}` : ''}`

/**
 * Столбики по месяцам: доход и расход — парой от общей нулевой линии (dataviz: два ряда во времени,
 * одна шкала), прибыль — отдельной полосой вверх (зелёным) и вниз (красным) от нуля, чтобы убыток был
 * виден сразу. Нажатие на месяц — открыть его. Месяцев больше 12 («всё время») — подписи через
 * несколько, январь — годом, чтобы было видно, где какой год.
 */
function MonthBars({ rows, picked, onPick }: { rows: MonthTotal[]; picked?: string; onPick: (m: string) => void }) {
  const max = Math.max(1, ...rows.flatMap((m) => [m.incomeSom, m.expenseSom + m.pendingSom]))
  const anyPending = rows.some((m) => m.pendingSom > 0)
  const maxProfit = Math.max(1, ...rows.map((m) => Math.abs(m.profitSom)))
  const step = Math.ceil(rows.length / 12)
  const label = (m: string) => (rows.length > 12 && m.endsWith('-01') ? m.slice(0, 4) : shortMonth(m))
  return (
    <>
      <div className="legend" aria-hidden="true"><span className="key fin-in" /> доход <span className="key fin-out" /> расход
        <span className="key fin-up" /> прибыль <span className="key fin-down" /> убыток
        {anyPending && <><span className="key fin-pending" /> ещё ожидается</>}</div>
      <div className="fin-bars" role="img" aria-label={rows.map(monthText).join('; ')}>
        {rows.map((m, k) => {
          const back = rows.length - 1 - k
          return (
            <button key={m.month} type="button" className={m.month === picked ? 'fin-month picked' : 'fin-month'} title={monthText(m)}
              aria-label={longMonth(m.month ?? '')} onClick={() => m.month && onPick(m.month)}>
              <span className="fin-pair">
                <span className="fin-in" style={{ height: `${(m.incomeSom / max) * 100}%` }} />
                {/* Прогноз пунктиром поверх расхода: шаблоны «каждый месяц» без отметки */}
                <span className="fin-stack" style={{ height: `${((m.expenseSom + m.pendingSom) / max) * 100}%` }}>
                  {m.pendingSom > 0 && <span className="fin-pending" style={{ flexGrow: m.pendingSom }} />}
                  <span className="fin-out" style={{ flexGrow: Math.max(m.expenseSom, m.pendingSom > 0 ? 0 : 1) }} />
                </span>
              </span>
              <span className="fin-profit" aria-hidden="true">
                <span className={m.profitSom < 0 ? 'fin-down' : 'fin-up'}
                  style={{ height: `${(Math.abs(m.profitSom) / maxProfit) * 50}%` }} />
              </span>
              {/* Подписи через step месяцев; на телефоне — ещё через одну: в 360px иначе слипаются */}
              <span className={back % step ? 'vbar-label fin-skip' : (back / step) % 2 ? 'vbar-label fin-odd' : 'vbar-label'}>{label(m.month ?? '')}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** 12 месяцев по выбранный — в режиме «Месяц». */
function HistoryBlock({ history, month, onPick }: { history: MonthTotal[]; month: string; onPick: (m: string) => void }) {
  const picked = history.find((m) => m.month === month)
  const empty = !history.some((m) => m.incomeSom || m.expenseSom)
  return (
    <section className="card-block chart" aria-label="За 12 месяцев">
      <h2>За 12 месяцев</h2>
      {empty ? <EmptyState compact title="За год ни доходов, ни расходов" /> : (
        <>
          <MonthBars rows={history} picked={month} onPick={onPick} />
          {picked && (
            <p className="hint small">{longMonth(picked.month ?? '')}: доход <b className="num">{somText(picked.incomeSom)}</b>,
              расход <b className="num">{somText(picked.expenseSom)}</b>,
              {' '}{picked.profitSom < 0 ? 'убыток' : 'прибыль'} <b className={`num ${tone(picked.profitSom) ?? ''}`.trim()}>{signed(picked.profitSom)}</b></p>
          )}
        </>
      )}
    </section>
  )
}

/** Период больше месяца: график и таблица по месяцам (доход, расход, прибыль), внизу — итог. */
function MonthsBlock({ months, onPick }: { months: MonthTotal[]; onPick: (m: string) => void }) {
  const sum = (k: 'incomeSom' | 'expenseSom' | 'profitSom') => months.reduce((s, m) => s + (m[k] ?? 0), 0)
  const empty = !months.some((m) => m.incomeSom || m.expenseSom)
  return (
    <section className="card-block chart" aria-label="По месяцам">
      <h2>По месяцам</h2>
      {empty ? <EmptyState compact title="За период ни доходов, ни расходов" /> : <MonthBars rows={months} onPick={onPick} />}
      <div className="table-scroll">
        <table className="table fin-months" aria-label="Итоги по месяцам">
          <thead><tr><th>Месяц</th><th className="r">Доход</th><th className="r">Расход</th><th className="r">Прибыль</th></tr></thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month}>
                <td><button type="button" className="link" onClick={() => m.month && onPick(m.month)}>{longMonth(m.month ?? '')}</button></td>
                <td className="r num nowrap">{somText(m.incomeSom)}</td>
                <td className="r num nowrap">{somText(m.expenseSom)}
                  {m.pendingSom > 0 && <div className="hint small">+ {somText(m.pendingSom)} ожидается</div>}</td>
                <td className={`r num nowrap ${tone(m.profitSom) ?? ''}`.trim()}>{signed(m.profitSom)}</td>
              </tr>
            ))}
            <tr className="strong">
              <td>Итого</td>
              <td className="r num nowrap">{somText(sum('incomeSom'))}</td>
              <td className="r num nowrap">{somText(sum('expenseSom'))}</td>
              <td className={`r num nowrap ${tone(sum('profitSom')) ?? ''}`.trim()}>{signed(sum('profitSom'))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Цена одной SMS в сомах — для строки «SMS» (отправлено × цена). Пусто — строка просит указать цену. */
function SmsPriceForm({ price }: { price?: number }) {
  const client = useQueryClient()
  const [value, setValue] = useState(price != null ? String(price) : '')
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/finance/settings', { body: { smsPriceSom: value === '' ? undefined : Number(value) } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-finance'] }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <section className="card-block" aria-label="Настройки финансов">
      <h2>Настройки</h2>
      <form className="form narrow" aria-label="Цена SMS" onSubmit={submit}>
        <label className="field"><span>Цена одной SMS, сом (по тарифу SMS-провайдера)</span>
          <input type="number" min={0} step="0.01" inputMode="decimal" value={value} placeholder="Например: 1,5"
            onChange={(e) => { save.reset(); setValue(e.target.value) }} /></label>
        {save.error && <p className="error" role="alert">{save.error.fieldErrors.smsPriceSom ?? save.error.message}</p>}
        <p className="hint small">Курс доллара для ИИ и НДС — во вкладке «Расход ИИ».</p>
        <button type="submit" className="btn" disabled={save.isPending}>Сохранить</button>
        {save.isSuccess && <p className="hint" role="status">Сохранено.</p>}
      </form>
    </section>
  )
}
