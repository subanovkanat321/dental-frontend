import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { changeOf, previousRange } from '../lib/compare'
import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SortTh } from '../layout/SortTh'
import { useSort } from '../lib/useSort'
import { PaymentsTable } from './PaymentsTable'
import { monthRange, shortDate, somText, todayIn, weekLabel } from '../lib/time'
import { MonthPicker } from '../layout/MonthPicker'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { HBars } from './HBars'
import { NetMonthTable } from './NetMonthTable'

type Me = Schemas['BookingViewsMe']
type Expense = Schemas['ExpensesExpense']
type ExpenseKey = 'when' | 'category' | 'sum'

function monthTitle(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`)).replace(' г.', '')
}

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

const scope = (doctorId: number | null) => (doctorId == null ? {} : { doctorId })

/** Прибыль клиники: выручка + аренда кресла, полученная от врачей, − склад − расходы. */
const profitOf = (s: Schemas['SpendingView']) => (s.revenueSom ?? 0) + (s.rentSom ?? 0) - (s.purchasedSom ?? 0) - (s.expensesSom ?? 0)

/**
 * «Расходы»: аренда, зарплаты, техник, свои статьи — за месяц, по статьям; добавить и удалить.
 * Админу (видит всю клинику) — «прибыль»: получено плюс аренда кресла от врачей минус покупки склада и
 * расходы (как в приложении). Аренда частного врача обычно уже вычтена из его выплаты («Зарплата» меньше);
 * отдельно она приходит, только когда врач должен клинике и принёс разницу.
 */
export function ExpensesTab({ me, doctorId, seesAll }: { me: Me; doctorId: number | null; seesAll: boolean }) {
  const client = useQueryClient()
  const [month, setMonth] = useState(todayIn().slice(0, 7))
  const range = monthRange(month)
  const list = useQuery({
    queryKey: ['expenses', month, doctorId],
    queryFn: () => unwrap(api.GET('/api/expenses', { params: { query: { ...range, ...scope(doctorId) } } })),
  })
  const categories = useQuery({ queryKey: ['expense-categories'], queryFn: () => unwrap(api.GET('/api/expenses/categories')), staleTime: 10 * 60_000 })
  const spending = useQuery({
    queryKey: ['spending', month],
    queryFn: () => unwrap(api.GET('/api/supplies/spending', { params: { query: range } })),
    enabled: seesAll && doctorId == null,
  })
  // Сравнение прибыли: текущий месяц — с теми же числами прошлого, прошедший — с прошлым целиком
  const current = month === todayIn().slice(0, 7)
  const before = previousRange('month', current ? { from: range.from, to: todayIn() } : range)
  const spendingBefore = useQuery({
    queryKey: ['spending', 'before', before.from, before.to],
    queryFn: () => unwrap(api.GET('/api/supplies/spending', { params: { query: { from: before.from, to: before.to } } })),
    enabled: seesAll && doctorId == null,
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['expenses'] })
    void client.invalidateQueries({ queryKey: ['spending'] })
  }
  const [form, setForm] = useState({ spentOn: todayIn(), amount: '', category: '', other: '', comment: '' })
  // Расход по пациенту (техник, лаборатория) — необязательно, как в прежнем приложении
  const [patient, setPatient] = useState<{ id: number; fullName: string } | null>(null)
  const add = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/expenses', {
      body: {
        spentOn: form.spentOn, amountSom: Number(form.amount), category: form.category === '*' ? form.other.trim() : form.category,
        comment: form.comment.trim() || undefined, doctorId: doctorId ?? undefined, patientId: patient?.id,
      },
    })),
    onSuccess: () => {
      setForm({ ...form, amount: '', comment: '', other: '' })
      setPatient(null)
      refresh()
    },
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/expenses/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  })
  const [category, setCategory] = useState('')
  const expenseValue = useCallback((x: Expense, key: ExpenseKey) => ({ when: x.spentOn, category: x.category, sum: x.amountSom })[key], [])
  const visible = (list.data ?? []).filter((x) => !category || x.category === category)
  const { sorted, sort, toggle } = useSort<Expense, ExpenseKey>(visible, expenseValue, { key: 'when', desc: true })
  const total = (list.data ?? []).reduce((s, x) => s + (x.amountSom ?? 0), 0)
  const byCategory = Object.entries((list.data ?? []).reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.category ?? '—']: (acc[x.category ?? '—'] ?? 0) + (x.amountSom ?? 0) }), {}))
    .sort((a, b) => b[1] - a[1])
  const cats = [...(categories.data?.standard ?? []), ...(categories.data?.own ?? [])]
  const sp = spending.data
  const profit = sp ? profitOf(sp) : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }

  return (
    <>
      <section className="card-block">
        <div className="block-head">
          <h2>Расходы · {monthTitle(month)}</h2>
          <MonthPicker label="Месяц" value={month} max={todayIn().slice(0, 7)} onChange={setMonth} />
        </div>
        <p className="total" aria-label="Расходы за месяц">{somText(total)}</p>
        {/* По статьям — ранжированные горизонтальные столбики, а не пирог (dataviz): статей бывает
            больше 6 (стандартные + свои), близкие суммы на столбиках с одной базой сравниваются
            точнее, длинные названия читаются, на 360px помещается. Нажатие — фильтр списка ниже. */}
        {byCategory.length > 0 && (
          <div className="expense-chart">
            <HBars rows={byCategory.map(([name, value]) => ({ name, value }))} label="Расходы по статьям"
              picked={category} onPick={(c) => setCategory(category === c ? '' : c)} />
            {byCategory.length > 1 && <p className="hint small">{category ? `В списке — только «${category}». Нажмите ещё раз — все статьи.` : 'Нажмите статью — в списке останется только она.'}</p>}
          </div>
        )}
        {profit != null && sp && (
          <div className="methods profit" aria-label="Прибыль за месяц">
            <div>Получено<b>{somText(sp.revenueSom ?? 0)}</b></div>
            {(sp.rentSom ?? 0) > 0 && <div>Аренда от врачей<b>{somText(sp.rentSom ?? 0)}</b></div>}
            <div>Склад<b>{somText(sp.purchasedSom ?? 0)}</b></div>
            <div>Расходы<b>{somText(sp.expensesSom ?? 0)}</b></div>
            <div className={profit < 0 ? 'tone-bad' : 'tone-ok'}>Прибыль<b>{somText(profit)}</b></div>
          </div>
        )}
        {profit != null && spendingBefore.data && (() => {
          const b = spendingBefore.data
          const was = profitOf(b)
          const c = changeOf(profit, was)
          return (
            <p className="compare" aria-label="Сравнение прибыли">
              Прибыль <b className={`tone-${c.tone}`}>{c.text}</b> {current ? before.label : 'к прошлому месяцу'}
              <span className="hint"> · было: получено {somText(b.revenueSom ?? 0)}, прибыль {somText(was)}</span>
            </p>
          )
        })()}
        {(sp?.unpricedDeliveries ?? 0) > 0 && <p className="tone-wait small">Поставок без суммы: {sp!.unpricedDeliveries} — расходы на склад занижены.</p>}
      </section>

      {seesAll && doctorId == null && <NetMonthTable month={month} />}

      <section className="card-block">
        <h2>Добавить расход</h2>
        <form className="expense-form" aria-label="Новый расход" onSubmit={submit}>
          <DateInput aria-label="Когда" value={form.spentOn} max={todayIn()} required onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
          <input type="number" aria-label="Сумма, сом" placeholder="Сумма, сом" min={1} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Select aria-label="Статья" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="" disabled>Статья…</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="*">Другое — своя статья</option>
          </Select>
          {form.category === '*' && <input aria-label="Своя статья" placeholder="Например: реклама" required maxLength={60} value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} />}
          <input aria-label="Комментарий" placeholder="Комментарий — необязательно" maxLength={200} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          <PatientPick value={patient} onChange={setPatient} />
          <button type="submit" className="btn primary" disabled={add.isPending}>Добавить</button>
        </form>
        {add.error && <p className="error" role="alert">{errorText(add.error)}</p>}
      </section>

      <section className="card-block">
        {byCategory.length > 1 && (
          <div className="filters">
            <Select aria-label="Статья расходов" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Все статьи</option>
              {byCategory.map(([c]) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        )}
        {list.isPending ? <p className="hint">Загрузка…</p> : list.data?.length ? (
          <table className="table" aria-label="Расходы">
            <thead><tr>
              <SortTh k="when" title="Дата" sort={sort} onSort={toggle} desc />
              <SortTh k="category" title="Статья" sort={sort} onSort={toggle} />
              <th>Комментарий</th>{seesAll && (me.doctors?.length ?? 0) > 1 && <th>Врач</th>}
              <SortTh k="sum" title="Сумма" sort={sort} onSort={toggle} desc right /><th />
            </tr></thead>
            <tbody>
              {sorted.map((x) => (
                <tr key={x.id}>
                  <td className="nowrap">{x.spentOn ? shortDate(`${x.spentOn}T12:00:00Z`) : ''}</td>
                  <td>{x.category}</td>
                  <td className="hint">{[x.comment, x.patient ? `пациент: ${x.patient}` : null].filter(Boolean).join(' · ') || '—'}</td>
                  {seesAll && (me.doctors?.length ?? 0) > 1 && <td>{x.doctor ?? 'клиника'}</td>}
                  <td className="r nowrap num strong">{somText(x.amountSom ?? 0)}</td>
                  <td className="r"><button type="button" className="btn small ghost" aria-label={`Удалить расход: ${x.category} ${x.amountSom}`}
                    disabled={remove.isPending} onClick={() => void ask('Удалить расход?').then((ok) => ok && remove.mutate(x.id!))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="hint">За {monthTitle(month)} расходов нет.</p>}
        {remove.error && <p className="error">{errorText(remove.error)}</p>}
      </section>
    </>
  )
}

/**
 * «Статистика»: неявки по неделям (ради этого проект: стало ли их меньше) и оценки пациентов за 90 дней.
 */
export function StatsTab({ doctorId }: { doctorId: number | null }) {
  const stats = useQuery({
    queryKey: ['stats', doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/stats', { params: { query: { weeks: 8, ...scope(doctorId) } } })),
  })
  const ratings = useQuery({
    queryKey: ['ratings', doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/ratings', { params: { query: { days: 90, ...scope(doctorId) } } })),
  })
  const weeks = stats.data ?? []
  // Среднее неявок — по прошедшим неделям, где были приёмы (текущая ещё идёт)
  const past = weeks.slice(1).filter((w) => (w.booked ?? 0) > 0)
  const average = past.length ? past.reduce((s, w) => s + (w.noShow ?? 0), 0) / past.length : null
  const unmarked = weeks.reduce((s, w) => s + (w.unmarked ?? 0), 0)
  const r = ratings.data
  const max = Math.max(1, ...(r?.byStars ?? []))

  return (
    <>
      <section className="card-block">
        <h2>Неявки по неделям</h2>
        {stats.error && <p className="error">{stats.error.message}</p>}
        <p className="total" aria-label="Неявок в неделю">{average == null ? '—' : String(Math.round(average * 10) / 10).replace('.', ',')}
          <span className="hint small"> неявок в неделю в среднем</span></p>
        {unmarked > 0 && <p className="tone-wait">Не отмечено «явка / неявка»: {unmarked} — без отметок неявки не посчитать.</p>}
        {weeks.length > 0 && (
          <table className="table" aria-label="Неявки по неделям">
            <thead><tr><th>Неделя</th><th className="r">Приёмов</th><th className="r">Состоялось</th><th className="r">Неявки</th><th className="r">Отменено</th><th className="r">Напомнили</th></tr></thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.weekStart}>
                  <td className="nowrap">{w.weekStart ? weekLabel(w.weekStart) : ''}{i === 0 && <span className="hint"> · эта неделя</span>}</td>
                  <td className="r num">{w.booked}</td>
                  <td className="r num">{w.done}</td>
                  <td className={`r num${w.noShow ? ' tone-bad strong' : ''}`}>{w.noShow}</td>
                  <td className="r num">{w.cancelled}</td>
                  <td className="r num">{w.reminded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card-block">
        <h2>Оценки пациентов · 90 дней</h2>
        {r && r.count ? (
          <>
            <p className="total" aria-label="Средняя оценка">{String(r.average).replace('.', ',')}<span className="hint small"> из 5 · оценок: {r.count}</span></p>
            <div className="stars" aria-label="Оценки по звёздам">
              {[5, 4, 3, 2, 1].map((stars) => (
                <div key={stars} className="stars-row">
                  <span className="num">{stars} ★</span>
                  <span className="stars-bar"><span style={{ width: `${((r.byStars?.[stars - 1] ?? 0) / max) * 100}%` }} /></span>
                  <span className="num hint">{r.byStars?.[stars - 1] ?? 0}</span>
                </div>
              ))}
            </div>
          </>
        ) : <p className="hint">Оценок пока нет. На следующий день после приёма бот спросит оценку у тех, кто записывался через бота.</p>}
      </section>
    </>
  )
}

/**
 * «Отчёт за месяц»: все приёмы с оплатой и долгами — таблицей; «Отправить в бот» — файл
 * придёт в Telegram (как в приложении), удобно переслать бухгалтеру.
 */
export function ReportTab({ doctorId, onOpen, active }: { doctorId: number | null; onOpen?: (id: number) => void; active?: number | null }) {
  const [month, setMonth] = useState(todayIn().slice(0, 7))
  const rows = useQuery({
    queryKey: ['report', month, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/report', { params: { query: { month, ...scope(doctorId) } } })),
  })
  const send = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/report', { body: { month, ...scope(doctorId) } })),
  })
  const range = monthRange(month)
  const sums = useQuery({
    queryKey: ['revenue', range.from, range.to, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { ...range, ...scope(doctorId) } } })),
  })
  return (
    <section className="card-block">
      <div className="block-head">
        <h2>Отчёт · {monthTitle(month)}</h2>
        <span className="actions">
          <MonthPicker label="Месяц отчёта" value={month} max={todayIn().slice(0, 7)} onChange={setMonth} />
          <button type="button" className="btn" disabled={send.isPending} onClick={() => send.mutate()}>Отправить в бот</button>
        </span>
      </div>
      {sums.data && (
        <div className="money-pair" aria-label="Итоги месяца">
          <p className="money-cell"><span>Касса: <b className="num">{somText(sums.data.cash?.totalSom ?? 0)}</b></span>
            <span className="hint small">деньги, полученные за период</span></p>
          <p className="money-cell"><span>По приёмам: <b className="num">{somText(sums.data.totalSom ?? 0)}</b></span>
            <span className="hint small">стоимость состоявшихся приёмов периода</span></p>
        </div>
      )}
      {send.isSuccess && <p className="tone-ok" role="status">Отчёт отправлен в Telegram</p>}
      {send.error && <p className="error" role="alert">{errorText(send.error)}</p>}
      {rows.error && <p className="error">{rows.error.message}</p>}
      {rows.data?.length ? <PaymentsTable rows={rows.data} label="Отчёт за месяц" withStatus onOpen={onOpen} active={active} days={monthRange(month)} />
        : rows.isSuccess ? <p className="hint">Приёмов за {monthTitle(month)} нет.</p> : null}
    </section>
  )
}

/** Пациент расхода — необязательно: найти по имени или номеру, выбрать; «✕» — без пациента. */
function PatientPick({ value, onChange }: { value: { id: number; fullName: string } | null; onChange: (p: { id: number; fullName: string } | null) => void }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: !value && search.length >= 2,
  })
  if (value) {
    return (
      <span className="chip picked-patient">Пациент: {value.fullName}
        <button type="button" className="link" aria-label="Без пациента" onClick={() => onChange(null)}>✕</button></span>
    )
  }
  return (
    <div className="patient-pick">
      <input type="search" aria-label="Пациент — необязательно" placeholder="Пациент — необязательно" value={query} onChange={(e) => setQuery(e.target.value)} />
      {found.data && found.data.length > 0 && (
        <ul className="found">
          {found.data.slice(0, 6).map((p) => (
            <li key={p.id}><button type="button" onClick={() => { onChange({ id: p.id!, fullName: p.fullName ?? '' }); setQuery('') }}>{p.fullName}</button></li>
          ))}
        </ul>
      )}
    </div>
  )
}
