import { useQueries, useQuery } from '@tanstack/react-query'
import { useRef, useState, type KeyboardEvent } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { changeOf, datesText, periodText } from '../lib/compare'
import { sourceLabel } from '../lib/sources'
import { addDays, monthRange, somText, todayIn, weekLabel, ZONE } from '../lib/time'
import { MonthPicker } from '../layout/MonthPicker'
import { Donut, type DonutPart } from '../lib/Donut'
import { percents } from '../lib/parts'
import { HBars } from './HBars'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { HeadTools } from '../layout/PageHead'

type Me = Schemas['BookingViewsMe']

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE })
const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'short' })
const MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const shortMonth = (m: string) => MONTH_SHORT.format(new Date(`${m}-01T00:00:00Z`)).replace('.', '')
const longMonth = (m: string) => MONTH_LONG.format(new Date(`${m}-01T00:00:00Z`)).replace(' г.', '')

/** 'YYYY-MM' на n месяцев назад. */
function monthBack(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) - n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Короткие суммы для подписей столбиков: 125 000 → «125 т». */
function short(som: number): string {
  if (som >= 1_000_000) return `${(Math.round(som / 100_000) / 10).toString().replace('.', ',')} млн`
  if (som >= 1000) return `${Math.round(som / 1000)} тыс`
  return String(som)
}

/**
 * «Аналитика» — четыре вопроса владельца клиники, по одной диаграмме на вопрос (dataviz: одна ось,
 * один цвет на ряд, подписи текстом, значение — по нажатию; таблицы — в «Отчёте» и «Статистике»):
 * растём ли (выручка 6 месяцев), ровно ли идут деньги (по дням периода), кто сколько приносит (врачи), что приносит деньги (услуги),
 * откуда приходят новые пациенты (и сколько возвращается), сколько теряем на неявках (недели). Считает сервер — здесь только рисуем.
 */
/** Период блоков «врачи» и «услуги»: последние 30 дней (по умолчанию — не пусто в начале месяца) или месяц. */
type Period = { label: string; from: string; to: string; months: string[] }

function last30(): Period {
  const to = todayIn()
  const from = addDays(to, -29)
  const months = from.slice(0, 7) === to.slice(0, 7) ? [to.slice(0, 7)] : [from.slice(0, 7), to.slice(0, 7)]
  return { label: 'за 30 дней', from, to, months }
}

export function AnalyticsTab({ me, doctorId, seesAll }: { me: Me; doctorId: number | null; seesAll: boolean }) {
  const [month, setMonth] = useState<string | null>(null)
  const scope = doctorId == null ? {} : { doctorId }
  const period: Period = month ? { label: `· ${longMonth(month)}`, ...rangeOf(month), months: [month] } : last30()
  return (
    <>
      {/* Период — в строку шапки «Кассы»; какие именно дни считаются — мелко рядом (в начале месяца
          «Месяц» почти пуст, а «30 дней» — нет) */}
      <HeadTools>
        <div className="analytics-filter" role="group" aria-label="Период аналитики">
          <div className="segments">
            <button type="button" aria-pressed={month == null} onClick={() => setMonth(null)}>30 дней</button>
            <button type="button" aria-pressed={month != null} onClick={() => setMonth(month ?? todayIn().slice(0, 7))}>Месяц</button>
          </div>
          {month && <MonthPicker label="Месяц аналитики" value={month} max={todayIn().slice(0, 7)} onChange={setMonth} />}
        </div>
        <span className="head-note" aria-label="Даты периода">
          {month ? periodText('month', period, todayIn()) : `${datesText(period)} — последние 30 дней по сегодня`}
        </span>
      </HeadTools>
      <MonthsChart month={month ?? todayIn().slice(0, 7)} scope={scope} />
      <DaysChart key={`${period.from}-${period.to}`} period={period} scope={scope} />
      {seesAll && doctorId == null && (me.doctors ?? []).filter((d) => d.active !== false).length > 1 && <DoctorsChart me={me} period={period} />}
      <ServicesChart period={period} scope={scope} />
      <div className="chart-pair">
        <MethodsChart period={period} scope={scope} />
        <OutcomesChart period={period} scope={scope} />
      </div>
      <LoadHeatmap period={period} scope={scope} />
      <div className="chart-pair">
        <SourcesChart period={period} scope={scope} />
        <VisitsChart period={period} scope={scope} />
      </div>
      <PromoChart period={period} scope={scope} />
      <NoShowChart scope={scope} />
    </>
  )
}

/** Текст первой ошибки запросов: при 403/500 — сообщение, а не «0 сом» и «оплат нет». */
function failed(queries: { error: Error | null }[]): string | null {
  return queries.find((q) => q.error)?.error?.message ?? null
}

/** Диапазон месяца; текущий — до сегодня (будущие дни выручки не дают). */
function rangeOf(month: string) {
  const r = monthRange(month)
  const today = todayIn()
  return r.to > today ? { from: r.from, to: today } : r
}

/** Выручка за 6 месяцев: растём или нет. Текущий месяц — «идёт», сравнение — с теми же днями прошлого. */
function MonthsChart({ month, scope }: { month: string; scope: { doctorId?: number } }) {
  const months = Array.from({ length: 6 }, (_, i) => monthBack(month, 5 - i))
  const data = useQueries({
    queries: months.map((m) => ({
      queryKey: ['revenue', rangeOf(m).from, rangeOf(m).to, scope.doctorId ?? null],
      queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { ...rangeOf(m), ...scope } } })),
    })),
  })
  const [picked, setPicked] = useState<number | null>(null)
  const values = data.map((q) => q.data?.totalSom ?? 0)
  const max = Math.max(1, ...values)
  const current = month === todayIn().slice(0, 7)
  // Главная цифра — последний ПОЛНЫЙ месяц: текущий ещё идёт, в начале месяца он почти пуст
  const full = current ? 4 : 5
  const last = values[full] ?? 0
  const change = changeOf(last, values[full - 1] ?? 0)
  const i = picked ?? 5
  return (
    <section className="card-block chart" aria-label="Выручка за 6 месяцев">
      <h2>Растём или нет?</h2>
      {data.some((q) => q.isPending) ? <Loading /> : failed(data) ? <p className="error">{failed(data)}</p> : (
        <>
          <p className="chart-headline"><b>{somText(last)}</b> за {longMonth(months[full]!)}
            <span className="hint"> по приёмам</span>
            <span className={`tone-${change.tone}`}> · {change.text}</span><span className="hint"> к прошлому месяцу ({somText(values[full - 1] ?? 0)})</span></p>
          <p className="hint" aria-label="Касса за месяц">Касса за {longMonth(months[full]!)}: <b className="num">{somText(data[full]?.data?.cash?.totalSom ?? 0)}</b>
            {' '}— деньги, полученные за период; по приёмам — стоимость состоявшихся приёмов периода</p>
          <div className="vbars" role="img" aria-label={months.map((m, k) => `${longMonth(m)}: ${somText(values[k] ?? 0)}`).join('; ')}>
            {months.map((m, k) => (
              <button key={m} type="button" className={['vbar', k === 5 && current ? 'partial' : '', k === i ? 'picked' : ''].join(' ').trim()}
                title={`${longMonth(m)}: ${somText(values[k] ?? 0)}`} onClick={() => setPicked(k)}>
                <span className="vbar-value num">{values[k] ? short(values[k]) : ''}</span>
                <span className="vbar-fill" style={{ height: `${((values[k] ?? 0) / max) * 100}%` }} />
                <span className="vbar-label">{shortMonth(m)}</span>
              </button>
            ))}
          </div>
          <p className="hint small">{longMonth(months[i]!)}: <b className="num">{somText(values[i] ?? 0)}</b>
            {data[i]?.data?.paidCount ? ` · оплат ${data[i].data.paidCount}` : ''}{i === 5 && current ? ' · по сегодня' : ''}</p>
        </>
      )}
    </section>
  )
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const at = (d: string) => new Date(`${d}T12:00:00Z`)
/** '2026-10-14' → «пн, 14 окт». */
const dayText = (d: string) => `${DOW[at(d).getUTCDay()]}, ${DAY_MONTH.format(at(d)).replace('.', '')}`

/**
 * Выручка по дням периода (по приёмам — как зарплаты и прибыль): ровно ли идут деньги, какие дни
 * пустые. dataviz: величина во времени, один ряд → столбики одного цвета от общей нулевой линии
 * (не линия: дни отдельные, у многих 0 — линия «протянула» бы выручку через выходные); не пирог —
 * частей больше 6. Подписи — только понедельники (неделя видна, на 360px не слипается); сумма —
 * у выбранного дня под графиком. Клавиатура: один столбик в Tab, ← → — соседний день, у каждого
 * столбика своя подпись для экранного диктора.
 */
function DaysChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  // Тот же запрос и ключ, что у «Как платят»: второй раз на сервер не ходим
  const data = useQuery({
    queryKey: ['revenue', period.from, period.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: period.from, to: period.to, ...scope } } })),
  })
  // Сервер отдаёт только дни с оплатами — пустые дни дорисовываем нулём
  const byDate = new Map((data.data?.days ?? []).map((d) => [d.date, d.totalSom]))
  const dates: string[] = []
  for (let d = period.from; d <= period.to && dates.length < 62; d = addDays(d, 1)) dates.push(d)
  const values = dates.map((d) => byDate.get(d) ?? 0)
  const total = values.reduce((s, v) => s + v, 0)
  const worked = values.filter((v) => v > 0).length
  const max = Math.max(1, ...values)
  const best = values.indexOf(Math.max(...values))
  const [picked, setPicked] = useState<number | null>(null)
  const i = picked ?? best
  const bars = useRef<(HTMLButtonElement | null)[]>([])
  const move = (e: KeyboardEvent, k: number) => {
    const next = e.key === 'ArrowLeft' ? k - 1 : e.key === 'ArrowRight' ? k + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? dates.length - 1 : null
    if (next == null || next < 0 || next >= dates.length) return
    e.preventDefault()
    setPicked(next)
    bars.current[next]?.focus()
  }
  return (
    <section className="card-block chart" aria-label="Выручка по дням">
      <h2>Выручка по дням {period.label}</h2>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : !total ? <EmptyState compact title="Оплат за этот период нет" /> : (
            <>
              <p className="chart-headline" aria-label="Среднее за день"><b>{somText(Math.round(total / worked))}</b> в среднем за день с оплатами
                <span className="hint"> · таких дней {worked} из {dates.length}</span></p>
              <div className="dbars" role="group" aria-label="Выручка по дням, столбики">
                {dates.map((d, k) => {
                  const v = values[k] ?? 0
                  const monday = at(d).getUTCDay() === 1
                  return (
                    <button key={d} ref={(el) => { bars.current[k] = el }} type="button"
                      className={['dbar', v ? '' : 'zero', k === i ? 'picked' : ''].join(' ').trim()}
                      aria-label={`${dayText(d)}: ${somText(v)}`} aria-pressed={k === i} tabIndex={k === i ? 0 : -1} title={`${dayText(d)}: ${somText(v)}`}
                      onClick={() => setPicked(k)} onKeyDown={(e) => move(e, k)}>
                      <span className="dbar-plot"><span className="dbar-fill" style={{ height: v ? `${(v / max) * 100}%` : undefined }} /></span>
                      <span className="dbar-label num" aria-hidden="true">{monday || k === 0 ? Number(d.slice(8)) : ''}</span>
                    </button>
                  )
                })}
              </div>
              <p className="hint small" aria-live="polite">{dayText(dates[i]!)}: <b className="num">{somText(values[i] ?? 0)}</b>
                {picked == null && <span> — лучший день</span>}{dates[i] === todayIn() && <span> · сегодня ещё идёт</span>}</p>
              <p className="hint small">Подписи под столбиками — понедельники. Нажмите столбик — сумма за день.</p>
            </>
          )}
    </section>
  )
}

/** Выручка по врачам за месяц (админ, вся клиника): кто сколько приносит. */
function DoctorsChart({ me, period }: { me: Me; period: Period }) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const range = { from: period.from, to: period.to }
  const data = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['revenue', range.from, range.to, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { ...range, doctorId: d.id } } })),
    })),
  })
  const rows = doctors.map((d, k) => ({ name: d.fullName ?? '', value: data[k]?.data?.totalSom ?? 0, note: `оплат ${data[k]?.data?.paidCount ?? 0}` }))
    .sort((a, b) => b.value - a.value)
  // 2–6 врачей — бублик (доли клиники с одного взгляда); больше — столбики: семь цветов уже не различить
  const parts: DonutPart[] = doctors.map((d, k) => ({ key: String(d.id), name: d.fullName ?? '', value: data[k]?.data?.totalSom ?? 0, note: `оплат ${data[k]?.data?.paidCount ?? 0}` }))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <section className="card-block chart" aria-label="Выручка по врачам">
      <h2>Кто сколько приносит {period.label}</h2>
      {data.some((q) => q.isPending) ? <Loading />
        : failed(data) ? <p className="error">{failed(data)}</p>
          : rows.every((r) => !r.value) ? <EmptyState compact title="Оплат за этот период нет" />
            : doctors.length <= 6 ? <Donut parts={parts} label="Выручка по врачам" format={somText} caption="выручка" center={somText(total)} />
              : <HBars rows={rows} label="Выручка по врачам" />}
    </section>
  )
}

/**
 * Приёмы периода (кроме заявок) из отчёта: сервер отдаёт его по месяцам, а 30 дней — это два
 * месяца, поэтому лишние дни отбрасываем. Общий кэш для услуг, исходов и загрузки.
 */
function usePeriodRows(period: Period, scope: { doctorId?: number }) {
  const reports = useQueries({
    queries: period.months.map((m) => ({
      queryKey: ['report', m, scope.doctorId ?? null],
      queryFn: () => unwrap(api.GET('/api/appointments/report', { params: { query: { month: m, ...scope } } })),
    })),
  })
  const rows = reports.flatMap((q) => q.data ?? []).filter((r) => {
    if (!r.startAt) return false
    const day = DAY.format(new Date(r.startAt))
    return day >= period.from && day <= period.to
  })
  return { rows, pending: reports.some((q) => q.isPending), error: failed(reports) }
}

/** Услуги по оплатам за месяц: что приносит деньги. Топ-6, остальное — «Другое». */
function ServicesChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const { rows, pending, error } = usePeriodRows(period, scope)
  const sums = new Map<string, { value: number; count: number }>()
  for (const r of rows) {
    if (!r.paidSom) continue
    const name = r.service || 'Без услуги'
    const s = sums.get(name) ?? { value: 0, count: 0 }
    sums.set(name, { value: s.value + r.paidSom, count: s.count + 1 })
  }
  const sorted = [...sums.entries()].map(([name, s]) => ({ name, value: s.value, note: `приёмов ${s.count}` })).sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, 6)
  const rest = sorted.slice(6)
  if (rest.length) top.push({ name: `Другое (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), note: '' })
  return (
    <section className="card-block chart" aria-label="Выручка по услугам">
      <h2>Что приносит деньги {period.label}</h2>
      {pending ? <Loading />
        : error ? <p className="error">{error}</p>
        : top.length ? <HBars rows={top} label="Выручка по услугам" />
          : <EmptyState compact title="Оплат за этот период нет">Услугу ставят при записи или в карточке приёма — тогда видно, что приносит деньги.</EmptyState>}
    </section>
  )
}

const people = (n: number) => `${n} чел.`

/** Как платят пациенты: наличные, перевод, карта — касса за период по способам. */
function MethodsChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const data = useQuery({
    queryKey: ['revenue', period.from, period.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { from: period.from, to: period.to, ...scope } } })),
  })
  // Касса по способам: деньги, полученные за период (доплаты и предоплаты — тоже), а не оплаты приёмов периода
  const by = data.data?.cash?.byMethod ?? {}
  const parts: DonutPart[] = [
    { key: 'CASH', name: 'Наличные', value: by.CASH ?? 0, color: 'var(--series-1)', icon: '💵' },
    { key: 'TRANSFER', name: 'Перевод', value: by.TRANSFER ?? 0, color: 'var(--series-2)', icon: '📲' },
    { key: 'CARD', name: 'Карта', value: by.CARD ?? 0, color: 'var(--series-3)', icon: '💳' },
  ]
  return (
    <section className="card-block chart" aria-label="Способы оплаты">
      <h2>Как платят {period.label}</h2>
      <p className="hint small">Касса — деньги, полученные за период</p>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : <Donut parts={parts} label="Способы оплаты" format={somText} caption="касса" empty="Оплат за этот период нет." />}
    </section>
  )
}

/** Чем закончились приёмы периода: состоялся, неявка, отменён (статусные цвета со значками). */
function OutcomesChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const { rows, pending, error } = usePeriodRows(period, scope)
  const count = (status: string) => rows.filter((r) => r.status === status).length
  const parts: DonutPart[] = [
    { key: 'DONE', name: 'Пришли', value: count('DONE'), color: 'var(--chart-1)', icon: '✅' },
    { key: 'NO_SHOW', name: 'Не пришли', value: count('NO_SHOW'), color: 'var(--chart-bad)', icon: '❌' },
    { key: 'CANCELLED', name: 'Отменили', value: count('CANCELLED'), color: 'var(--faint)', icon: '↩️' },
  ]
  return (
    <section className="card-block chart" aria-label="Чем закончились приёмы">
      <h2>Чем закончились приёмы {period.label}</h2>
      {pending ? <Loading />
        : error ? <p className="error">{error}</p>
          : <Donut parts={parts} label="Чем закончились приёмы" center={`${percents(parts.map((p) => p.value))[0]}%`} caption="пришли"
            empty="Прошедших приёмов за этот период нет." />}
    </section>
  )
}

const WEEK_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' })
const WEEKDAY_NUM = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short' })
const WD_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

/**
 * Загрузка: когда в клинике больше всего приёмов — дни недели × часы (dataviz: тепловая карта,
 * один цвет от светлого к тёмному). Видно, когда ставить второго врача или ассистента, а когда
 * давать рекламу «есть свободное время».
 */
function LoadHeatmap({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const { rows, pending, error } = usePeriodRows(period, scope)
  const grid = Array.from({ length: 7 }, () => new Map<number, number>())
  for (const r of rows) {
    if (r.status === 'CANCELLED') continue
    const at = new Date(r.startAt!)
    const h = Number(HOUR.format(at))
    const wd = WD_INDEX[WEEKDAY_NUM.format(at)] ?? 0
    grid[wd]!.set(h, (grid[wd]!.get(h) ?? 0) + 1)
  }
  const hours = grid.flatMap((m) => [...m.keys()])
  const from = hours.length ? Math.min(...hours, 9) : 9
  const to = hours.length ? Math.max(...hours, 17) : 17
  const cols = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const days = WEEK_SHORT.map((_, i) => i).filter((i) => i < 6 || grid[i]!.size > 0)
  const max = Math.max(1, ...grid.flatMap((m) => [...m.values()]))
  let peak = { wd: -1, h: 0, n: 0 }
  grid.forEach((m, wd) => m.forEach((n, h) => { if (n > peak.n) peak = { wd, h, n } }))
  const fill = (n: number) => (n ? `color-mix(in oklab, var(--chart-1) ${Math.round(18 + (82 * n) / max)}%, var(--card))` : 'var(--sunken)')
  return (
    <section className="card-block chart" aria-label="Загрузка по дням и часам">
      <h2>Когда больше всего приёмов {period.label}</h2>
      {pending ? <Loading /> : error ? <p className="error">{error}</p> : !rows.length ? <EmptyState compact title="Приёмов за этот период нет" /> : (
        <>
          {peak.n > 0 && <p className="chart-headline">Пик — <b>{WEEK_SHORT[peak.wd]} {String(peak.h).padStart(2, '0')}:00</b> <span className="hint">· {peak.n} {peak.n === 1 ? 'приём' : 'приёмов'}</span></p>}
          <div className="heatmap" role="table" aria-label="Приёмы по дням недели и часам" style={{ gridTemplateColumns: `2.4em repeat(${cols.length}, minmax(0, 1fr))` }}>
            <span role="columnheader" />
            {cols.map((h) => <span key={h} role="columnheader" className="heat-h num">{h}</span>)}
            {days.map((wd) => (
              <div key={wd} role="row" className="heat-row">
                <span role="rowheader" className="heat-d">{WEEK_SHORT[wd]}</span>
                {cols.map((h) => {
                  const n = grid[wd]!.get(h) ?? 0
                  return <span key={h} role="cell" className="heat-cell" style={{ background: fill(n) }}
                    title={`${WEEK_SHORT[wd]} ${String(h).padStart(2, '0')}:00 — ${n} ${n === 1 ? 'приём' : 'приёмов'}`}
                    aria-label={`${WEEK_SHORT[wd]} ${h}:00 — ${n}`} />
                })}
              </div>
            ))}
          </div>
          <p className="heat-legend hint" aria-hidden="true">меньше
            {[0.15, 0.4, 0.65, 1].map((k) => <span key={k} className="heat-cell" style={{ background: fill(Math.max(1, Math.round(k * max))) }} />)} больше</p>
        </>
      )}
    </section>
  )
}

/** Запрос «источники и визиты» периода: общий кэш для «Откуда новые пациенты» и «Возвращаются ли». */
function useSources(period: Period, scope: { doctorId?: number }) {
  return useQuery({
    queryKey: ['sources', period.from, period.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/sources', { params: { query: { from: period.from, to: period.to, ...scope } } })),
  })
}

/**
 * Откуда приходят новые пациенты (первый приём в клинике — в этом периоде): работает ли реклама.
 * Бублик — до 6 источников, мелкие сверх того — в «Другое»; в центре — сколько новых.
 */
function SourcesChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const data = useSources(period, scope)
  // Названия — с сервера, из списка клиники; скрытый вариант тоже: история не пропадает
  const parts: DonutPart[] = (data.data?.newPatients ?? []).map((s, k) => ({
    key: s.sourceId == null ? `none-${k}` : String(s.sourceId), name: `${sourceLabel(s)}${s.active === false ? ' (скрыт)' : ''}`, value: s.patients,
  }))
  const total = parts.reduce((sum, r) => sum + r.value, 0)
  const unknown = parts.find((r) => r.name === 'Не указано')?.value ?? 0
  return (
    <section className="card-block chart" aria-label="Откуда новые пациенты">
      <h2>Откуда новые пациенты {period.label}</h2>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : (
            <>
              <Donut parts={parts} label="Новые пациенты по источникам" format={people} center={String(total)}
                caption={total === 1 ? 'новый пациент' : 'новых пациентов'} empty="Новых пациентов за этот период нет." />
              {unknown > 0 && <p className="hint">«Не указано» — в карточке пациента не выбрано «Откуда узнал о клинике». Спрашивайте при первой записи — так видно, какая реклама работает.</p>}
            </>
          )}
    </section>
  )
}

/** Первичные и повторные визиты периода: возвращаются ли пациенты. В центре — доля повторных. */
function VisitsChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const data = useSources(period, scope)
  const first = data.data?.firstVisits ?? 0
  const repeat = data.data?.repeatVisits ?? 0
  const parts: DonutPart[] = [
    { key: 'FIRST', name: 'Первичные', value: first },
    { key: 'REPEAT', name: 'Повторные', value: repeat },
  ]
  return (
    <section className="card-block chart" aria-label="Первичные и повторные визиты">
      <h2>Возвращаются ли пациенты {period.label}</h2>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : (
            <>
              <Donut parts={parts} label="Первичные и повторные визиты" center={`${percents([first, repeat])[1]}%`} caption="повторных"
                empty="Состоявшихся визитов за этот период нет." />
              {first + repeat > 0 && (
                <p className="visits-split hint small" aria-label="Визиты за период">
                  Состоялось визитов: <b className="num">{first + repeat}</b> — первичных <b className="num">{first}</b>, повторных <b className="num">{repeat}</b>
                </p>
              )}
            </>
          )}
    </section>
  )
}

/**
 * Промокоды рекламы: по каждому коду за период — записи, пришли, новые пациенты и оплаты (за приём с
 * кодом и лечение после него). Кодов с записями нет — подсказка, где их завести.
 */
function PromoChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const data = useQuery({
    queryKey: ['promo-report', period.from, period.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/promo-codes', { params: { query: { from: period.from, to: period.to, ...scope } } })),
  })
  const rows = (data.data?.rows ?? []).filter((r) => r.bookings > 0)
  const money = Boolean(data.data?.money)
  return (
    <section className="card-block chart" aria-label="Промокоды">
      <h2>Промокоды {period.label}</h2>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : rows.length === 0 ? (
            data.data?.rows?.length ? <EmptyState compact title="По промокодам за этот период записей нет" />
              : <EmptyState compact title="Промокодов нет">Заведите код для рекламы в «Настройки → Откуда приходят пациенты → Промокоды» — здесь будет видно, приводит ли он пациентов.</EmptyState>
          ) : (
            <table className="table" aria-label="Промокоды за период">
              <thead><tr><th>Промокод</th><th className="num">Записей</th><th className="num">Пришли</th><th className="num">Новых</th>
                {money && <th className="num">Оплачено</th>}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.promoCodeId}>
                    <td>{r.code}{r.description && <span className="hint"> · {r.description}</span>}</td>
                    <td className="num">{r.bookings}</td>
                    <td className="num">{r.visits}</td>
                    <td className="num">{r.newPatients}</td>
                    {money && <td className="num">{somText(r.revenueSom ?? 0)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </section>
  )
}

/** Неявки за 12 недель: главная цифра — доля неявок; столбики — состоялось и неявка по неделям. */
function NoShowChart({ scope }: { scope: { doctorId?: number } }) {
  const stats = useQuery({
    queryKey: ['stats', 12, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/stats', { params: { query: { weeks: 12, ...scope } } })),
  })
  const weeks = [...(stats.data ?? [])].reverse() // сервер — новые сверху, на графике — слева направо
  const done = weeks.reduce((s, w) => s + w.done, 0)
  const noShow = weeks.reduce((s, w) => s + w.noShow, 0)
  const share = done + noShow ? Math.round((noShow / (done + noShow)) * 100) : null
  const max = Math.max(1, ...weeks.map((w) => w.done + w.noShow))
  return (
    <section className="card-block chart" aria-label="Неявки по неделям">
      <h2>Сколько теряем на неявках</h2>
      {stats.isPending ? <Loading /> : share == null ? <EmptyState compact title="Отмеченных приёмов за 12 недель пока нет" /> : (
        <>
          <p className="chart-headline"><b>{share}%</b> приёмов — неявка<span className="hint"> · {noShow} из {done + noShow} за 12 недель</span></p>
          <div className="legend" aria-hidden="true"><span className="key done" /> состоялось <span className="key bad" /> неявка</div>
          <div className="vbars stacked" role="img" aria-label={weeks.map((w) => `${w.weekStart ? weekLabel(w.weekStart) : ''}: состоялось ${w.done}, неявок ${w.noShow}`).join('; ')}>
            {weeks.map((w) => (
              <div key={w.weekStart} className="vbar" title={`${w.weekStart ? weekLabel(w.weekStart) : ''}: состоялось ${w.done}, неявок ${w.noShow}`}>
                <span className="vbar-stack" style={{ height: `${((w.done + w.noShow) / max) * 100}%` }}>
                  {w.noShow > 0 && <span className="seg bad" style={{ flexGrow: w.noShow }} />}
                  {w.done > 0 && <span className="seg done" style={{ flexGrow: w.done }} />}
                </span>
                <span className="vbar-label">{w.weekStart ? Number(w.weekStart.slice(8)) : ''}</span>
              </div>
            ))}
          </div>
          <p className="hint small">Подписи — число, с которого начинается неделя. Неявок много — напоминайте накануне (кнопка в «Дне») и просите предоплату у новых пациентов.</p>
        </>
      )}
    </section>
  )
}
