import { useQueries, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { changeOf } from '../lib/compare'
import { sourceText } from '../lib/sources'
import { addDays, monthRange, somText, todayIn, weekLabel, ZONE } from '../lib/time'

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
 * растём ли (выручка 6 месяцев), кто сколько приносит (врачи), что приносит деньги (услуги),
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
      <div className="analytics-filter" role="group" aria-label="Период аналитики">
        <div className="segments">
          <button type="button" aria-pressed={month == null} onClick={() => setMonth(null)}>30 дней</button>
          <button type="button" aria-pressed={month != null} onClick={() => setMonth(month ?? todayIn().slice(0, 7))}>Месяц</button>
        </div>
        {month && <input type="month" aria-label="Месяц аналитики" value={month} max={todayIn().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
      </div>
      <MonthsChart month={month ?? todayIn().slice(0, 7)} scope={scope} />
      {seesAll && doctorId == null && (me.doctors ?? []).filter((d) => d.active !== false).length > 1 && <DoctorsChart me={me} period={period} />}
      <ServicesChart period={period} scope={scope} />
      <SourcesChart period={period} scope={scope} />
      <NoShowChart scope={scope} />
    </>
  )
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
      <h2>📈 Растём или нет?</h2>
      <p className="chart-headline"><b>{somText(last)}</b> за {longMonth(months[full]!)}
        <span className={`tone-${change.tone}`}> · {change.text}</span><span className="hint"> к прошлому месяцу ({somText(values[full - 1] ?? 0)})</span></p>
      {data.some((q) => q.isPending) ? <p className="hint">Загрузка…</p> : (
        <>
          <div className="vbars" role="img" aria-label={months.map((m, k) => `${longMonth(m)}: ${somText(values[k] ?? 0)}`).join('; ')}>
            {months.map((m, k) => (
              <button key={m} type="button" className={['vbar', k === 5 && current ? 'partial' : '', k === i ? 'picked' : ''].join(' ').trim()}
                title={`${longMonth(m)}: ${somText(values[k] ?? 0)}`} onClick={() => setPicked(k)}>
                <span className="vbar-value num">{values[k] ? short(values[k]!) : ''}</span>
                <span className="vbar-fill" style={{ height: `${((values[k] ?? 0) / max) * 100}%` }} />
                <span className="vbar-label">{shortMonth(m)}</span>
              </button>
            ))}
          </div>
          <p className="hint small">{longMonth(months[i]!)}: <b className="num">{somText(values[i] ?? 0)}</b>
            {data[i]?.data?.paidCount ? ` · оплат ${data[i]!.data!.paidCount}` : ''}{i === 5 && current ? ' · по сегодня' : ''}</p>
        </>
      )}
    </section>
  )
}

/** Горизонтальные столбики «название — сумма», по убыванию; подпись значения — текстом рядом. */
function HBars({ rows, label, format = somText }: { rows: { name: string; value: number; note?: string }[]; label: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} title={`${r.name}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}>
          <span className="hbar-name">{r.name}</span>
          <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="hbar-value num">{format(r.value)}<span className="hint"> · {total ? Math.round((r.value / total) * 100) : 0}%</span></span>
        </li>
      ))}
    </ul>
  )
}

/** Выручка по врачам за месяц (админ, вся клиника): кто сколько приносит. */
function DoctorsChart({ me, period }: { me: Me; period: Period }) {
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const range = { from: period.from, to: period.to }
  const data = useQueries({
    queries: doctors.map((d) => ({
      queryKey: ['revenue', range.from, range.to, d.id],
      queryFn: () => unwrap(api.GET('/api/appointments/revenue', { params: { query: { ...range, doctorId: d.id! } } })),
    })),
  })
  const rows = doctors.map((d, k) => ({ name: d.fullName ?? '', value: data[k]?.data?.totalSom ?? 0, note: `оплат ${data[k]?.data?.paidCount ?? 0}` }))
    .sort((a, b) => b.value - a.value)
  return (
    <section className="card-block chart" aria-label="Выручка по врачам">
      <h2>👩‍⚕️ Кто сколько приносит {period.label}</h2>
      {data.some((q) => q.isPending) ? <p className="hint">Загрузка…</p>
        : rows.every((r) => !r.value) ? <p className="hint">Оплат за этот период нет.</p>
          : <HBars rows={rows} label="Выручка по врачам" />}
    </section>
  )
}

/** Услуги по оплатам за месяц: что приносит деньги. Топ-6, остальное — «Другое». */
function ServicesChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  // Отчёт сервер отдаёт по месяцам: 30 дней — это два месяца, лишние дни отбрасываем
  const reports = useQueries({
    queries: period.months.map((m) => ({
      queryKey: ['report', m, scope.doctorId ?? null],
      queryFn: () => unwrap(api.GET('/api/appointments/report', { params: { query: { month: m, ...scope } } })),
    })),
  })
  const sums = new Map<string, { value: number; count: number }>()
  for (const r of reports.flatMap((q) => q.data ?? [])) {
    if (!r.paidSom || !r.startAt) continue
    const day = DAY.format(new Date(r.startAt))
    if (day < period.from || day > period.to) continue
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
      <h2>🦷 Что приносит деньги {period.label}</h2>
      {reports.some((q) => q.isPending) ? <p className="hint">Загрузка…</p>
        : top.length ? <HBars rows={top} label="Выручка по услугам" />
          : <p className="hint">Оплат за этот период нет. Услугу ставят при записи или в карточке приёма — тогда видно, что приносит деньги.</p>}
    </section>
  )
}

const people = (n: number) => `${n} чел.`

/**
 * Откуда приходят новые пациенты (первый приём в клинике — в этом периоде) и сколько визитов
 * первичных, а сколько повторных: работает ли реклама и возвращаются ли пациенты.
 */
function SourcesChart({ period, scope }: { period: Period; scope: { doctorId?: number } }) {
  const data = useQuery({
    queryKey: ['sources', period.from, period.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/sources', { params: { query: { from: period.from, to: period.to, ...scope } } })),
  })
  const rows = (data.data?.newPatients ?? []).map((s) => ({ name: sourceText(s.source), value: s.patients ?? 0 }))
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  const first = data.data?.firstVisits ?? 0
  const repeat = data.data?.repeatVisits ?? 0
  const unknown = rows.find((r) => r.name === 'Не указано')?.value ?? 0
  return (
    <section className="card-block chart" aria-label="Откуда новые пациенты">
      <h2>📣 Откуда новые пациенты {period.label}</h2>
      {data.isPending ? <p className="hint">Загрузка…</p>
        : data.error ? <p className="error">{data.error.message}</p>
          : (
            <>
              <p className="chart-headline"><b className="num">{total}</b> {total === 1 ? 'новый пациент' : 'новых пациентов'}</p>
              {rows.length ? <HBars rows={rows} label="Новые пациенты по источникам" format={people} />
                : <p className="hint">Новых пациентов за этот период нет.</p>}
              {unknown > 0 && <p className="hint">«Не указано» — в карточке пациента не выбрано «Откуда узнал о клинике». Спрашивайте при первой записи — так видно, какая реклама работает.</p>}
              <p className="visits-split" aria-label="Первичные и повторные визиты">
                Состоялось визитов: <b className="num">{first + repeat}</b> — первичных <b className="num">{first}</b>, повторных <b className="num">{repeat}</b>
                {first + repeat > 0 && <span className="hint"> · возвращаются {Math.round((repeat / (first + repeat)) * 100)}%</span>}
              </p>
            </>
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
  const done = weeks.reduce((s, w) => s + (w.done ?? 0), 0)
  const noShow = weeks.reduce((s, w) => s + (w.noShow ?? 0), 0)
  const share = done + noShow ? Math.round((noShow / (done + noShow)) * 100) : null
  const max = Math.max(1, ...weeks.map((w) => (w.done ?? 0) + (w.noShow ?? 0)))
  return (
    <section className="card-block chart" aria-label="Неявки по неделям">
      <h2>🚷 Сколько теряем на неявках</h2>
      {stats.isPending ? <p className="hint">Загрузка…</p> : share == null ? <p className="hint">Отмеченных приёмов за 12 недель пока нет.</p> : (
        <>
          <p className="chart-headline"><b>{share}%</b> приёмов — неявка<span className="hint"> · {noShow} из {done + noShow} за 12 недель</span></p>
          <div className="legend" aria-hidden="true"><span className="key done" /> состоялось <span className="key bad" /> неявка</div>
          <div className="vbars stacked" role="img" aria-label={weeks.map((w) => `${w.weekStart ? weekLabel(w.weekStart) : ''}: состоялось ${w.done ?? 0}, неявок ${w.noShow ?? 0}`).join('; ')}>
            {weeks.map((w) => (
              <div key={w.weekStart} className="vbar" title={`${w.weekStart ? weekLabel(w.weekStart) : ''}: состоялось ${w.done ?? 0}, неявок ${w.noShow ?? 0}`}>
                <span className="vbar-stack" style={{ height: `${(((w.done ?? 0) + (w.noShow ?? 0)) / max) * 100}%` }}>
                  {(w.noShow ?? 0) > 0 && <span className="seg bad" style={{ flexGrow: w.noShow }} />}
                  {(w.done ?? 0) > 0 && <span className="seg done" style={{ flexGrow: w.done }} />}
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
