import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { Donut } from '../lib/Donut'
import { shortDate, somText, todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { EmptyState } from '../layout/EmptyState'
import { MonthPicker } from '../layout/MonthPicker'

type Finance = Schemas['PlatformFinanceFinance']
type Line = Schemas['PlatformFinanceLine']
type Expense = Schemas['PlatformExpensesExpense']
type MonthTotal = Schemas['PlatformFinanceMonthTotal']

const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const shortMonth = (m: string) => MONTH_SHORT.format(new Date(`${m}-01T00:00:00Z`)).replace('.', '')
const longMonth = (m: string) => MONTH_LONG.format(new Date(`${m}-01T00:00:00Z`)).replace(' г.', '')

/** Прибыль со знаком: −1 200 сом — убыток. */
const signed = (som: number) => (som < 0 ? `−${somText(-som)}` : somText(som))
const tone = (som: number) => (som < 0 ? 'tone-bad' : som > 0 ? 'tone-ok' : undefined)

/** 1.5 → «1,5»: цена SMS и курс — как пишут у нас. */
const decimal = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)

/**
 * «Платформа → Финансы» (только владелец платформы, сервер отвечает 403 остальным): доходы — оплаты
 * клиник за подписку, расходы — ИИ и SMS сами (из учёта токенов и журнала SMS) плюс ручные статьи
 * (Claude, реклама, сервер…; разовые и «каждый месяц»), прибыль и 12 месяцев на графике. Считает
 * сервер (/api/platform/finance) — здесь только показываем и вводим ручные расходы.
 */
export function FinanceTab() {
  const current = todayIn().slice(0, 7)
  const [month, setMonth] = useState(current)
  const query = useQuery<Finance, ApiError>({
    queryKey: ['platform-finance', month],
    queryFn: () => unwrap(api.GET('/api/platform/finance', { params: { query: { month } } })),
  })
  const f = query.data
  return (
    <>
      <section className="card-block" aria-label="Итог месяца">
        <div className="toolbar">
          <h2>Финансы</h2>
          <MonthPicker label="Месяц финансов" value={month} max={current} onChange={setMonth} />
        </div>
        {query.error && <p className="error" role="alert">{query.error.message}</p>}
        {query.isPending ? <p className="hint">Загрузка…</p> : f && (
          <div className="survey-tiles fin-tiles">
            <div className="survey-tile"><span className="hint">Доходы</span><b className="num" aria-label="Доходы за месяц">{somText(f.incomeSom ?? 0)}</b></div>
            <div className="survey-tile"><span className="hint">Расходы</span><b className="num" aria-label="Расходы за месяц">{somText(f.expenseSom ?? 0)}</b></div>
            <div className="survey-tile hero"><span className="hint">{(f.profitSom ?? 0) < 0 ? 'Убыток' : 'Прибыль'}</span>
              <b className={`num ${tone(f.profitSom ?? 0) ?? ''}`.trim()} aria-label="Прибыль за месяц">{signed(f.profitSom ?? 0)}</b></div>
          </div>
        )}
      </section>
      {f && <ExpensesBlock f={f} />}
      {f && <IncomeBlock f={f} />}
      {f && <HistoryBlock history={f.history ?? []} month={month} onPick={setMonth} />}
      {f && <SmsPriceForm key={String(f.settings?.smsPriceSom ?? '')} price={f.settings?.smsPriceSom} />}
    </>
  )
}

/** Подпись строки расходов: что за число и откуда. */
function lineNote(l: Line, price?: number): string {
  if (l.key === 'AI') return l.count ? `${l.count} запросов к ИИ · как во вкладке «Расход ИИ»` : 'запросов к ИИ не было'
  if (l.key === 'SMS') {
    if (l.needsPrice) return `${l.count ?? 0} SMS · укажите цену SMS ниже`
    return `${l.count ?? 0} SMS × ${decimal(price ?? 0)} сом`
  }
  return (l.count ?? 0) > 1 ? `записей: ${l.count}` : ''
}

function ExpensesBlock({ f }: { f: Finance }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const lines = f.expenses ?? []
  const entries = f.entries ?? []
  return (
    <section className="card-block" aria-label="Расходы">
      <div className="block-head">
        <h2>Расходы</h2>
        {!adding && <button type="button" className="btn primary small" onClick={() => { setAdding(true); setEditing(null) }}>Добавить расход</button>}
      </div>
      {/* Структура расходов месяца — бублик; ниже те же статьи списком с пометками «считается само» */}
      <Donut parts={lines.filter((l) => !l.needsPrice && (l.som ?? 0) > 0).map((l) => ({ key: l.key ?? l.label ?? '', name: l.label ?? '', value: l.som ?? 0 }))}
        label="Структура расходов за месяц" format={somText} center={somText(f.expenseSom ?? 0)} caption="расходы месяца"
        empty="Расходов за этот месяц нет." />
      <dl className="net-lines fin-lines" aria-label="Расходы по статьям">
        {lines.map((l) => (
          <div key={l.key}>
            <dt>{l.label}
              {l.auto && <span className="chip small s-quiet">считается само</span>}
              {lineNote(l, f.settings?.smsPriceSom) && (
                <span className={`hint small${l.needsPrice ? ' tone-wait' : ''}`}> · {lineNote(l, f.settings?.smsPriceSom)}</span>
              )}
            </dt>
            <dd className="num">{l.needsPrice ? '—' : somText(l.som ?? 0)}</dd>
          </div>
        ))}
        <div className="net-total"><dt>Всего расходов</dt><dd className="num">{somText(f.expenseSom ?? 0)}</dd></div>
      </dl>
      {adding && (
        <ExpenseForm categories={f.categories ?? []} rate={f.settings?.lastUsdRate} month={f.month ?? ''} onDone={() => setAdding(false)} />
      )}
      <h3>Записи вручную</h3>
      {entries.length === 0 ? (
        <EmptyState compact icon="🧾" title="В этом месяце ручных расходов нет.">
          Claude, реклама, сервер и домен, пополнение SMS-провайдера — «Добавить расход». Подписку отметьте «каждый месяц»: она сама попадёт в следующие месяцы.
        </EmptyState>
      ) : (
        <ul className="fin-entries" aria-label="Ручные расходы месяца">
          {entries.map((x) => (
            <li key={x.id}>
              {editing === x.id ? (
                <ExpenseForm expense={x} categories={f.categories ?? []} rate={f.settings?.lastUsdRate} month={f.month ?? ''}
                  onDone={() => setEditing(null)} />
              ) : (
                <div className="fin-entry">
                  <div>
                    <b>{x.category}</b>
                    {x.monthly && <span className="chip small s-quiet">каждый месяц</span>}
                    <div className="hint small">{entryNote(x)}</div>
                  </div>
                  <span className="num strong nowrap">{somText(x.amountSom ?? 0)}</span>
                  <button type="button" className="btn ghost small" aria-label={`Исправить: ${x.category}`}
                    onClick={() => { setEditing(x.id ?? null); setAdding(false) }}>Исправить</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
      ? unwrap(api.PUT('/api/platform/finance/expenses/{id}', { params: { path: { id: x.id! } }, body: body() }))
      : unwrap(api.POST('/api/platform/finance/expenses', { body: body() }))),
    onSuccess: done,
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/finance/expenses/{id}', { params: { path: { id: x!.id! } } })),
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
        Каждый месяц — подписка, сервер: попадёт в каждый месяц до отмены</label>
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
              ? 'Удалить расход? Он пропадёт из всех месяцев. Если подписку просто отменили — укажите дату отмены.'
              : 'Удалить расход?').then((ok) => ok && remove.mutate())}>Удалить</button>
        )}
      </div>
    </form>
  )
}

function IncomeBlock({ f }: { f: Finance }) {
  const rows = f.income ?? []
  return (
    <section className="card-block" aria-label="Доходы по клиникам">
      <h2>Доходы по клиникам</h2>
      <p className="hint small">Оплаты подписки, отмеченные в «Клиники» → клиника → «Оплата», — по дню оплаты. Считается само.</p>
      {rows.length === 0 ? (
        <EmptyState compact icon="💳" title="В этом месяце оплат от клиник не было." />
      ) : (
        <div className="table-scroll">
          <table className="table" aria-label="Оплаты клиник за месяц">
            <thead><tr><th>Клиника</th><th className="r">Оплат</th><th className="r">Сумма</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clinicId}>
                  <td>{r.name}</td>
                  <td className="r num">{r.payments}</td>
                  <td className="r num nowrap">{somText(r.som ?? 0)}</td>
                </tr>
              ))}
              <tr className="strong"><td>Всего</td><td /><td className="r num nowrap">{somText(f.incomeSom ?? 0)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * 12 месяцев: доход и расход — парой столбиков от общей нулевой линии (dataviz: два ряда во времени,
 * одна шкала), прибыль — отдельной полосой вверх (зелёным) и вниз (красным) от нуля, чтобы убыток был
 * виден сразу. Нажатие на месяц — открыть его.
 */
function HistoryBlock({ history, month, onPick }: { history: MonthTotal[]; month: string; onPick: (m: string) => void }) {
  const max = Math.max(1, ...history.flatMap((m) => [m.incomeSom ?? 0, m.expenseSom ?? 0]))
  const maxProfit = Math.max(1, ...history.map((m) => Math.abs(m.profitSom ?? 0)))
  const picked = history.find((m) => m.month === month)
  const empty = !history.some((m) => m.incomeSom || m.expenseSom)
  const text = (m: MonthTotal) => `${longMonth(m.month ?? '')}: доход ${somText(m.incomeSom ?? 0)}, расход ${somText(m.expenseSom ?? 0)}, прибыль ${signed(m.profitSom ?? 0)}`
  return (
    <section className="card-block chart" aria-label="За 12 месяцев">
      <h2>За 12 месяцев</h2>
      {empty ? <p className="hint">За год ни доходов, ни расходов — график появится с первой оплатой или расходом.</p> : (
        <>
          <div className="legend" aria-hidden="true"><span className="key fin-in" /> доход <span className="key fin-out" /> расход
            <span className="key fin-up" /> прибыль <span className="key fin-down" /> убыток</div>
          <div className="fin-bars" role="img" aria-label={history.map(text).join('; ')}>
            {history.map((m, k) => (
              <button key={m.month} type="button" className={m.month === month ? 'fin-month picked' : 'fin-month'} title={text(m)}
                aria-label={longMonth(m.month ?? '')} onClick={() => onPick(m.month ?? month)}>
                <span className="fin-pair">
                  <span className="fin-in" style={{ height: `${((m.incomeSom ?? 0) / max) * 100}%` }} />
                  <span className="fin-out" style={{ height: `${((m.expenseSom ?? 0) / max) * 100}%` }} />
                </span>
                <span className="fin-profit" aria-hidden="true">
                  <span className={(m.profitSom ?? 0) < 0 ? 'fin-down' : 'fin-up'}
                    style={{ height: `${(Math.abs(m.profitSom ?? 0) / maxProfit) * 50}%` }} />
                </span>
                {/* На телефоне подписи через одну: 12 месяцев в 360px иначе слипаются */}
                <span className={(history.length - 1 - k) % 2 ? 'vbar-label fin-odd' : 'vbar-label'}>{shortMonth(m.month ?? '')}</span>
              </button>
            ))}
          </div>
          {picked && (
            <p className="hint small">{longMonth(picked.month ?? '')}: доход <b className="num">{somText(picked.incomeSom ?? 0)}</b>,
              расход <b className="num">{somText(picked.expenseSom ?? 0)}</b>,
              {' '}{(picked.profitSom ?? 0) < 0 ? 'убыток' : 'прибыль'} <b className={`num ${tone(picked.profitSom ?? 0) ?? ''}`.trim()}>{signed(picked.profitSom ?? 0)}</b></p>
          )}
        </>
      )}
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
