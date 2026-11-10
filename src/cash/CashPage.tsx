import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { seesToPay, seesAllMoney } from '../lib/roles'
import { EarningsTab } from '../earnings/EarningsTab'
import { api, unwrap, type Schemas } from '../api/client'
import { changeOf, datesText, periodText, previousRange } from '../lib/compare'
import { addDays, periodOf, shortDate, somText, todayIn, ZONE } from '../lib/time'
import { AppointmentPanel } from '../schedule/AppointmentPanel'
import { AnalyticsTab } from './Analytics'
import { SalaryTab } from './SalaryTab'
import { ExpensesTab, ReportTab, StatsTab } from './MoreTabs'
import { PaymentsTable } from './PaymentsTable'
import { SortTh } from '../layout/SortTh'
import { useSort } from '../lib/useSort'
import { HeadSlotProvider, HeadTools, PageHead } from '../layout/PageHead'
import { useHeadSlot } from '../layout/headSlot'
import { EmptyState } from '../layout/EmptyState'
import { DateInput } from '../layout/DateInput'
import { Select } from '../layout/Select'
import { DebtorsTab } from './DebtorsTab'
import { Loading } from '../layout/Loading'
import { HelpHint } from '../help/HelpHint'
import { SectionTitle } from '../layout/section'
import { useSection } from '../layout/useSection'

type Me = Schemas['BookingViewsMe']
type Debt = Schemas['PaymentQueryDebt']

/** Месяцы периода 'YYYY-MM' — не больше 12 (отчёт сервер отдаёт помесячно). */
function monthsOf(from: string, to: string): string[] {
  const out: string[] = []
  let m = from.slice(0, 7)
  while (m <= to.slice(0, 7) && out.length < 12) {
    out.push(m)
    const [y, mm] = m.split('-').map(Number)
    m = mm === 12 ? `${y! + 1}-01` : `${y}-${String(mm! + 1).padStart(2, '0')}`
  }
  return out
}

/** День приёма по Бишкеку. */
function dayOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

const METHODS: Record<string, string> = { CASH: 'Наличные', TRANSFER: 'Перевод', CARD: 'Карта' }

type Period = 'day' | 'week' | 'month' | 'custom'
type Tab = 'money' | 'earnings' | 'analytics' | 'expenses' | 'debtors' | 'salary' | 'stats' | 'report'


/**
 * «Касса»: за период рядом две суммы — касса (деньги, полученные в эти дни, по дате платежа) и
 * выручка по приёмам (оплачено за состоявшиеся приёмы периода), по способам и по дням, «К оплате на кассе» и долги — таблицами.
 * Нажать на строку — карточка приёма справа с оплатой, как в «Расписании». Права — как на
 * сервере: всю клинику видит админ (если врачи не независимы), врач — свою; «К оплате» —
 * регистратура и клиники с регистратурой.
 */
export function CashPage({ me, onOpenPatient }: { me: Me; onOpenPatient?: (patientId: number) => void }) {
  const seesAll = seesAllMoney(me)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // Чья касса: админ выбирает (пусто — вся клиника), врач — всегда своя
  const [doctorId, setDoctorId] = useState<number | null>(seesAll ? null : me.doctorId ?? null)
  const money = seesAll || me.doctorId != null
  // «Ждут оплаты на кассе»: «независимому» админу без своего кресла сервер его не отдаст (403)
  const toPayShown = seesToPay(me)

  // Подраздел (бывшие вкладки) — в меню слева, адрес #/cash/<подраздел>; права — layout/nav.ts
  // («Мой заработок» — только у врача со своим креслом). Без денег — один экран «К оплате»
  const { sub, subTitle } = useSection('cash', me)
  const tab = (sub ?? 'money') as Tab
  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState(periodOf('month'))
  // «День» — любой день: по умолчанию сегодня, можно выбрать вчера или любую дату
  const [day, setDay] = useState(todayIn())
  const range = period === 'custom' ? custom : period === 'day' ? { from: day, to: day } : periodOf(period)
  const prev = previousRange(period, range)
  const [opened, setOpened] = useState<number | null>(null)
  const close = useCallback(() => setOpened(null), [setOpened])

  const doctorQuery = doctorId == null ? {} : { doctorId }
  const revenue = useQuery({
    queryKey: ['revenue', range.from, range.to, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { ...range, ...doctorQuery } } })),
    enabled: money && range.from <= range.to,
  })
  // С чем сравнить: тот же день прошлой недели, прошлая неделя, те же числа прошлого месяца
  const before = useQuery({
    queryKey: ['revenue', prev.from, prev.to, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: prev.from, to: prev.to, ...doctorQuery } } })),
    enabled: money && tab === 'money' && range.from <= range.to,
  })
  const debts = useQuery({
    queryKey: ['debts', 'cash', doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: doctorQuery } })),
    enabled: money,
  })
  const toPay = useQuery({
    queryKey: ['to-pay'],
    queryFn: () => unwrap(api.GET('/api/appointments/to-pay')),
    enabled: toPayShown,
  })

  // Приёмы с оплатой за период — новые сверху. Отчёт сервер отдаёт по месяцам: берём месяцы периода
  const months = monthsOf(range.from, range.to)
  const reports = useQueries({
    queries: months.map((month) => ({
      queryKey: ['report', month, doctorId],
      queryFn: () => unwrap(api.GET('/api/appointments/report', { params: { query: { month, ...doctorQuery } } })),
      enabled: money && tab === 'money',
    })),
  })
  const payments = reports.flatMap((q) => q.data ?? [])
    .filter((x) => x.startAt && dayOf(x.startAt) >= range.from && dayOf(x.startAt) <= range.to)
    .filter((x) => x.paidSom != null || (x.debtSom ?? 0) > 0)

  const [slot, setSlot] = useHeadSlot()
  const r = revenue.data
  const max = Math.max(1, ...(r?.days ?? []).map((d) => d.totalSom ?? 0))

  return (
    <div className={opened ? 'schedule with-panel' : 'schedule'}>
      <HeadSlotProvider slot={slot}>
      <section className="schedule-main cash">
        <PageHead slotRef={setSlot} title={<SectionTitle page="cash" title="Касса" subTitle={subTitle} hint={<HelpHint hint="cash" />} />}>
          {seesAll && doctors.length > 1 && (
            <Select aria-label="Чья касса" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Вся клиника</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </Select>
          )}
        </PageHead>

        {tab === 'earnings' && <EarningsTab me={me} />}
        {tab === 'analytics' && <AnalyticsTab me={me} doctorId={doctorId} seesAll={seesAll} />}
        {tab === 'expenses' && <ExpensesTab me={me} doctorId={doctorId} seesAll={seesAll} />}
        {tab === 'debtors' && <DebtorsTab rows={debts.data} pending={debts.isPending} error={debts.error?.message} onOpen={setOpened}
          onOpenPatient={onOpenPatient} />}
        {tab === 'salary' && <SalaryTab seesAll={seesAll} />}
        {tab === 'stats' && <StatsTab doctorId={doctorId} />}
        {tab === 'report' && <ReportTab doctorId={doctorId} onOpen={setOpened} active={opened} />}
        {tab === 'money' && <>

        {toPayShown && (
          <section className="card-block">
            <h2>К оплате на кассе</h2>
            <DebtTable rows={toPay.data} pending={toPay.isPending} error={toPay.error?.message} empty="Никто не ждёт оплаты"
              money="chargeSom" onOpen={setOpened} active={opened} label="К оплате на кассе" />
          </section>
        )}

        {money && (
          <section className="card-block" aria-label="Касса и выручка">
            {/* Период и его даты — в строку шапки «Кассы», не отдельными строками над карточкой */}
            <HeadTools>
              <div className="segments" role="group" aria-label="Период">
                {([['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['custom', 'Период']] as const).map(([key, title]) => (
                  <button key={key} type="button" aria-pressed={period === key} onClick={() => setPeriod(key)}>{title}</button>
                ))}
              </div>
              {period !== 'custom' && <span className="head-note" aria-label="Даты периода">{periodText(period, range, todayIn())}</span>}
            </HeadTools>
            {period === 'day' && (
              <div className="day-pick">
                <label className="field"><span>День</span>
                  <DateInput weekday value={day} max={todayIn()} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
                <div className="day-quick" role="group" aria-label="Быстро">
                  <button type="button" className="chip" aria-pressed={day === todayIn()} onClick={() => setDay(todayIn())}>Сегодня</button>
                  <button type="button" className="chip" aria-pressed={day === addDays(todayIn(), -1)} onClick={() => setDay(addDays(todayIn(), -1))}>Вчера</button>
                </div>
              </div>
            )}
            {period === 'custom' && (
              <div className="row dates">
                <label className="field"><span>С</span>
                  <DateInput value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
                </label>
                <label className="field"><span>По</span>
                  <DateInput value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
                </label>
              </div>
            )}
            {revenue.error && <p className="error">{revenue.error.message}</p>}
            {r && (
              <>
                <div className="money-pair">
                  <div className="money-cell">
                    <h3>Касса</h3>
                    <p className="total" aria-label="Касса за период">{somText(r.cash?.totalSom ?? 0)}</p>
                    <p className="hint small">Касса — деньги, полученные за период</p>
                    <p className="hint">
                      Поступлений: {r.cash?.paymentsCount ?? 0}
                      {Object.entries(r.cash?.byMethod ?? {}).filter(([, v]) => v).map(([k, v]) => ` · ${METHODS[k] ?? k}: ${somText(v)}`).join('')}
                      {r.cash?.depositsSom ? ` · из них предоплаты: ${somText(r.cash.depositsSom)}` : ''}
                    </p>
                  </div>
                  <div className="money-cell">
                    <h3>По приёмам</h3>
                    <p className="total" aria-label="Выручка за период">{somText(r.totalSom ?? 0)}</p>
                    <p className="hint small">По приёмам — стоимость состоявшихся приёмов периода</p>
                    <p className="hint">
                      Оплачено приёмов: {r.paidCount ?? 0}
                      {r.unpaidCount ? <span className="tone-wait"> · без оплаты: {r.unpaidCount}</span> : null}
                      {r.freeCount ? ` · бесплатно: ${r.freeCount}` : ''}
                      {r.prepaidCount ? ` · оплачено заранее: ${r.prepaidCount}` : ''}
                      {Object.entries(r.byMethod ?? {}).filter(([, v]) => v).map(([k, v]) => ` · ${METHODS[k] ?? k}: ${somText(v)}`).join('')}
                    </p>
                  </div>
                </div>
                {before.data && (() => {
                  const c = changeOf(r.totalSom ?? 0, before.data.totalSom ?? 0)
                  // Период включает сегодня — день ещё идёт, а сравниваем с полным: утром «▼ 80%»
                  // не тревога, поэтому без красного и с пометкой
                  const ongoing = range.to >= todayIn()
                  return (
                    <p className="compare" aria-label="Сравнение выручки">
                      По приёмам: <b className={`tone-${ongoing && c.tone === 'bad' ? 'quiet' : c.tone}`}>{c.text}</b> {prev.label}
                      {ongoing && <span className="hint"> (сегодня ещё идёт)</span>}
                      <span className="hint"> ({datesText(prev)}) · было {somText(before.data.totalSom ?? 0)}, оплат {before.data.paidCount ?? 0}</span>
                    </p>
                  )
                })()}
                {(r.days?.length ?? 0) > 1 && (
                  <div className="bars" role="img" aria-label="Выручка по дням">
                    {r.days!.map((d) => (
                      <div key={d.date} className="bar" title={`${shortDate(`${d.date}T12:00:00Z`)}: ${somText(d.totalSom ?? 0)}`}>
                        <span style={{ height: `${((d.totalSom ?? 0) / max) * 100}%` }} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {money && (
          <section className="card-block">
            <h2>Последние оплаты</h2>
            {reports.some((q) => q.isPending) ? <Loading />
              : <PaymentsTable rows={payments} label="Последние оплаты" onOpen={setOpened} active={opened} />}
          </section>
        )}

        {money && (
          <section className="card-block">
            <h2>Долги пациентов {debts.data?.length ? `· ${somText(debts.data.reduce((s, d) => s + (d.debtSom ?? 0), 0))}` : ''}</h2>
            {debts.data?.length ? (
              <p className="hint">
                Пациентов: {new Set(debts.data.map((d) => d.patientId ?? d.patient)).size}
                {debts.data.some((d) => d.dueOn && d.dueOn < todayIn()) && (
                  <span className="tone-bad"> · просрочено: {debts.data.filter((d) => d.dueOn && d.dueOn < todayIn()).length}</span>
                )}
              </p>
            ) : null}
            <DebtTable rows={debts.data} pending={debts.isPending} error={debts.error?.message} empty="Долгов нет"
              money="debtSom" onOpen={setOpened} active={opened} label="Долги пациентов" />
          </section>
        )}

        {!money && !toPayShown && (
          <p className="hint">{me.admin && me.clinic?.independentDoctors
            ? 'В клинике включено «Врачи работают независимо» (Настройки → О клинике): в этом режиме каждый врач видит только свою кассу, общей кассы нет.'
            : 'Касса — у руководителя и врачей.'}</p>
        )}
        </>}
      </section>
      </HeadSlotProvider>
      {opened && <OpenedAppointment id={opened} me={me} onClose={close} onOpenPatient={onOpenPatient} />}
    </div>
  )
}

type DebtKey = 'patient' | 'when' | 'doctor' | 'service' | 'sum' | 'due'

/** Долги и «К оплате» таблицей: новые сверху, сортировка по любой колонке, поиск по пациенту. */
function DebtTable({ rows, pending, error, empty, money, onOpen, active, label }: {
  rows?: Debt[]
  pending: boolean
  error?: string
  empty: string
  money: 'chargeSom' | 'debtSom'
  onOpen: (id: number) => void
  active: number | null
  label: string
}) {
  const [query, setQuery] = useState('')
  const value = useCallback((d: Debt, key: DebtKey) => ({
    patient: d.patient, when: d.startAt, doctor: d.doctor, service: d.service, sum: d[money], due: d.dueOn,
  })[key], [money])
  const text = query.trim().toLowerCase()
  const filtered = (rows ?? []).filter((d) => !text || (d.patient ?? '').toLowerCase().includes(text))
  const { sorted, sort, toggle } = useSort<Debt, DebtKey>(filtered, value, { key: 'when', desc: true })
  if (pending) return <Loading />
  if (error) return <p className="error">{error}</p>
  if (!rows?.length) return <EmptyState compact title={empty} />
  const today = todayIn()
  return (
    <>
      {rows.length > 5 && (
        <div className="filters">
          <input type="search" aria-label={`Пациент: ${label}`} placeholder="Пациент" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            <SortTh k="patient" title="Пациент" sort={sort} onSort={toggle} />
            <SortTh k="when" title="Приём" sort={sort} onSort={toggle} desc />
            <SortTh k="doctor" title="Врач" sort={sort} onSort={toggle} />
            <SortTh k="service" title="Услуга" sort={sort} onSort={toggle} />
            <SortTh k="sum" title={money === 'debtSom' ? 'Долг' : 'Сумма'} sort={sort} onSort={toggle} desc right />
            {money === 'debtSom' && <SortTh k="due" title="Доплатит до" sort={sort} onSort={toggle} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.appointmentId} className={d.appointmentId === active ? 'active' : undefined}>
              <td><button type="button" className="row-link" onClick={() => onOpen(d.appointmentId!)}>{d.patient}</button></td>
              <td className="nowrap">{d.startAt ? shortDate(d.startAt, true) : ''}</td>
              <td>{d.doctor}</td>
              <td className="hint">{d.service ?? '—'}</td>
              <td className="nowrap strong num r">{somText(d[money] ?? 0)}</td>
              {money === 'debtSom' && (
                <td className={`nowrap${d.dueOn && d.dueOn < today ? ' tone-bad' : ''}`}>
                  {d.dueOn ? shortDate(`${d.dueOn}T12:00:00Z`) : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length && <EmptyState compact title="По поиску никого" />}
    </>
  )
}

/** Приём из строки таблицы — с сервера, и карточка с оплатой справа. */
function OpenedAppointment({ id, me, onClose, onOpenPatient }: { id: number; me: Me; onClose: () => void; onOpenPatient?: (patientId: number) => void }) {
  const a = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}', { params: { path: { id } } })),
  })
  if (a.isPending) return <aside className="panel" aria-label="Карточка приёма"><Loading /></aside>
  if (a.error) return <aside className="panel" aria-label="Карточка приёма"><p className="error">{a.error.message}</p></aside>
  return <AppointmentPanel key={a.data.id} appointment={a.data} me={me} onClose={onClose} onOpenPatient={onOpenPatient} />
}
