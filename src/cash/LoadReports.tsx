import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { datesText } from '../lib/compare'
import { percents } from '../lib/parts'
import { addDays, monthRange, somText, todayIn, weekStart } from '../lib/time'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Kind = 'week' | 'month' | 'custom'
type Range = { from: string; to: string }

/** Загрузка ниже — «есть свободные окна» (подсвечиваем). */
const LOW_LOAD = 50

/** Минуты словами: 90 → «1,5 ч», 45 → «45 мин», 6000 → «100 ч». */
function hoursText(minutes: number): string {
  if (minutes > 0 && minutes < 60) return `${minutes} мин`
  const h = Math.round(minutes / 6) / 10
  return `${String(h).replace('.', ',')} ч`
}

/** Неделя и месяц — целиком (с днями впереди: загрузка — это и уже записанное), свои даты — до года. */
function rangeOf(kind: Kind, custom: Range, today = todayIn()): Range {
  if (kind === 'week') {
    const from = weekStart(today)
    return { from, to: addDays(from, 6) }
  }
  if (kind === 'month') return monthRange(today.slice(0, 7))
  return custom
}

/**
 * «Загрузка врачей и кресел» и «Конверсия пациентов» (шаг 5Б, опыт Dentist Plus) — два вопроса руководителя за
 * неделю, месяц или свои даты: хватает ли записей на рабочие часы и доходят ли пациенты до лечения. Всё считает
 * сервер (часы, перерывы, выходные, кто что видит); здесь — только рисуем. doctorId — врач из шапки «Кассы».
 */
export function LoadReports({ doctorId }: { doctorId: number | null }) {
  const [kind, setKind] = useState<Kind>('week')
  const today = todayIn()
  const [custom, setCustom] = useState<Range>({ from: addDays(today, -29), to: today })
  const range = rangeOf(kind, custom, today)
  const valid = range.from <= range.to && range.from >= addDays(range.to, -366)
  const scope = doctorId == null ? {} : { doctorId }
  return (
    <>
      <div className="analytics-filter load-filter" role="group" aria-label="Период загрузки и конверсии">
        <div className="segments">
          <button type="button" aria-pressed={kind === 'week'} onClick={() => setKind('week')}>Эта неделя</button>
          <button type="button" aria-pressed={kind === 'month'} onClick={() => setKind('month')}>Этот месяц</button>
          <button type="button" aria-pressed={kind === 'custom'} onClick={() => setKind('custom')}>Свои даты</button>
        </div>
        {kind === 'custom' ? (
          <span className="load-dates">
            <label>с <input type="date" aria-label="С какого дня" value={custom.from} max={custom.to}
              onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
            <label>по <input type="date" aria-label="По какой день" value={custom.to} min={custom.from}
              onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
          </span>
        ) : <span className="head-note">{datesText(range)} — вместе с уже записанным впереди</span>}
      </div>
      {!valid ? <p className="error">Период — до года, «с» не позже «по».</p> : (
        <div className="chart-pair">
          <LoadChart range={range} scope={scope} />
          <ConversionChart range={range} scope={scope} />
        </div>
      )}
    </>
  )
}

type LoadRow = { key: string; name: string; percent: number | null; booked: number; base: number; note: string }

/** Полосы загрузки: длина — %, шкала 0–100 % (а не «доля от всех»); ниже {@link LOW_LOAD} — подсвечено. */
function LoadBars({ rows, label }: { rows: LoadRow[]; label: string }) {
  return (
    <ul className="hbars load-bars" aria-label={label}>
      {rows.map((r) => {
        const low = r.percent != null && r.percent < LOW_LOAD
        const text = `${r.name}: ${r.percent == null ? 'нет рабочих часов' : `${r.percent}%`} · занято ${hoursText(r.booked)} из ${hoursText(r.base)}${r.note ? ` · ${r.note}` : ''}`
        return (
          <li key={r.key} className={low ? 'low' : undefined} title={text} aria-label={text}>
            <span className="hbar-name">{r.name}{low && <span className="load-free">есть свободные окна</span>}</span>
            <span className="hbar-track" aria-hidden="true"><span className="hbar-fill" style={{ width: `${Math.min(100, r.percent ?? 0)}%` }} /></span>
            <span className="hbar-value num">{r.percent == null ? '—' : `${r.percent}%`}
              <span className="hint"> · {hoursText(r.booked)} из {hoursText(r.base)}</span></span>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Загрузка: рабочие часы врача (часы работы минус перерывы, выходные, отпуск), сколько занято записями и сколько
 * состоялось; самые свободные — сверху. Кресла — когда клиника открыта или работает врач кресла.
 */
function LoadChart({ range, scope }: { range: Range; scope: { doctorId?: number } }) {
  const data = useQuery({
    queryKey: ['load-report', range.from, range.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/load', { params: { query: { ...range, ...scope } } })),
  })
  const r = data.data
  const doctors: LoadRow[] = (r?.doctors ?? []).map((d: Schemas['OwnerReportsDoctorLoad']) => ({
    key: `d${d.doctorId}`, name: d.name, percent: d.loadPercent ?? null, booked: d.bookedMinutes - d.outsideMinutes, base: d.plannedMinutes,
    note: [`состоялось ${hoursText(d.doneMinutes)}`, d.outsideMinutes > 0 ? `вне часов ещё ${hoursText(d.outsideMinutes)}` : ''].filter(Boolean).join(' · '),
  }))
  const chairs: LoadRow[] = (r?.chairs ?? []).map((c: Schemas['OwnerReportsChairLoad']) => ({
    key: `c${c.chairId}`, name: c.name, percent: c.loadPercent ?? null, booked: c.bookedMinutes, base: c.availableMinutes, note: '',
  }))
  return (
    <section className="card-block chart" aria-label="Загрузка врачей и кресел">
      <h2>Загрузка врачей{chairs.length ? ' и кресел' : ''}</h2>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : !doctors.length || !r ? <EmptyState compact title="Врачей с часами работы за этот период нет" />
            : (
              <>
                <p className="chart-headline">
                  <b className="num">{r.loadPercent == null ? '—' : `${r.loadPercent}%`}</b> загрузка
                  <span className="hint"> · занято {hoursText(r.bookedMinutes)} из {hoursText(r.plannedMinutes)} рабочих · состоялось {hoursText(r.doneMinutes)}</span>
                </p>
                <LoadBars rows={doctors} label="Загрузка врачей" />
                {chairs.length > 0 && (
                  <>
                    <h3 className="load-sub">Кресла</h3>
                    <LoadBars rows={chairs} label="Загрузка кресел" />
                  </>
                )}
                <p className="hint small">Рабочие часы — «Часы работы» врача (нет своих — часы клиники) минус перерывы, выходные и отпуск. Занято — записи, кроме отменённых. Меньше {LOW_LOAD} % — свободные окна: лист ожидания, «Вернуть пациентов», реклама.</p>
              </>
            )}
    </section>
  )
}

/** Конверсия: записались → пришли → отменили / не пришли → продолжили лечение; новые и постоянные; средний чек. */
function ConversionChart({ range, scope }: { range: Range; scope: { doctorId?: number } }) {
  const data = useQuery({
    queryKey: ['conversion-report', range.from, range.to, scope.doctorId ?? null],
    queryFn: () => unwrap(api.GET('/api/appointments/conversion', { params: { query: { ...range, ...scope } } })),
  })
  const c = data.data
  return (
    <section className="card-block chart" aria-label="Конверсия пациентов">
      <h2>Конверсия пациентов</h2>
      {data.isPending ? <Loading />
        : data.error ? <p className="error">{data.error.message}</p>
          : !c || c.booked === 0 ? <EmptyState compact title="Записей за этот период нет" />
            : <ConversionBody c={c} />}
    </section>
  )
}

function ConversionBody({ c }: { c: Schemas['OwnerReportsConversionView'] }) {
  const [done, cancelled, noShow, waiting] = percents([c.done, c.cancelled, c.noShow, c.waiting])
  const steps = [
    { key: 'booked', name: 'Записались', value: c.booked, share: 100, tone: '' },
    { key: 'done', name: 'Пришли', value: c.done, share: done!, tone: '' },
    { key: 'cancelled', name: 'Отменили', value: c.cancelled, share: cancelled!, tone: 'muted' },
    { key: 'noShow', name: 'Не пришли', value: c.noShow, share: noShow!, tone: 'bad' },
    ...(c.waiting > 0 ? [{ key: 'waiting', name: 'Ещё ждут', value: c.waiting, share: waiting!, tone: 'muted' }] : []),
  ]
  const continued = c.patients ? Math.round((c.continued / c.patients) * 100) : null
  return (
    <>
      <p className="chart-headline"><b className="num">{done}%</b> пришли<span className="hint"> · {c.done} из {c.booked} записей</span></p>
      <ul className="hbars funnel" aria-label="Записались, пришли, отменили, не пришли">
        {steps.map((s) => (
          <li key={s.key} className={s.tone || undefined} title={`${s.name}: ${s.value} (${s.share}%)`}>
            <span className="hbar-name">{s.name}</span>
            <span className="hbar-track" aria-hidden="true"><span className="hbar-fill" style={{ width: `${s.share}%` }} /></span>
            <span className="hbar-value num">{s.value}<span className="hint"> · {s.share}%</span></span>
          </li>
        ))}
      </ul>
      <dl className="conversion-facts">
        <div aria-label="Продолжили лечение">
          <dt>Продолжили лечение</dt>
          <dd><b className="num">{continued == null ? '—' : `${continued}%`}</b>
            <span className="hint"> · {c.continued} из {c.patients} пришедших</span></dd>
        </div>
        <div aria-label="Новые и постоянные">
          <dt>Новые / бывали раньше</dt>
          <dd><b className="num">{c.newPatients}</b> / <b className="num">{c.returningPatients}</b></dd>
        </div>
        {c.money && (
          <div aria-label="Средний чек">
            <dt>Средний чек</dt>
            <dd><b className="num">{c.avgCheckSom == null ? '—' : somText(c.avgCheckSom)}</b>
              {c.paidVisits ? <span className="hint"> · {somText(c.revenueSom ?? 0)} за {c.paidVisits} приёмов</span> : null}</dd>
          </div>
        )}
      </dl>
      <p className="hint small">Продолжили — после визита записаны снова или план лечения в работе. Средний чек — оплачено за состоявшиеся приёмы (со скидкой), делённое на оплаченные приёмы.</p>
    </>
  )
}
