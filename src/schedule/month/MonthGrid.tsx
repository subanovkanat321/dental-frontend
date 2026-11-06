import { type CSSProperties } from 'react'

import { dayTitle } from '../../lib/time'
import { Loading } from '../../layout/Loading'
import { MONTH_KINDS, monthGridDays, monthStats, recordsText, type MonthKind } from './monthModel'
import type { useMonthData } from './useMonth'
import './month.css'

/** Подписи точек статусов — во множественном числе, как читают итог дня: «2 — заявки». */
const KIND_TEXT: Record<MonthKind, string> = {
  request: 'заявки', wait: 'ждём ответа', ok: 'придут', cashier: 'ждут оплаты', done: 'состоялись', bad: 'неявки', quiet: 'не напомнили',
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/**
 * «Месяц»: сетка пн–вс, в ячейке дня — сколько записей, точки статусов и полоска загрузки (занятые
 * минуты от рабочего времени выбранных врачей). Нерабочий день — штриховкой, как нерабочее время в
 * «Дне»; сегодня — число в коралловом кружке, как «сейчас». Нажать на день — этот день в «Дне».
 * На телефоне — только число записей и полоска: точки и подписи не влезают в 50 px.
 */
export function MonthGrid({ month, today, selected, data, compact = false, onOpenDay }: {
  /** 'YYYY-MM'. */
  month: string
  today: string
  /** День, открытый в «Дне», — обведён. */
  selected: string
  /** useMonthData — в SchedulePage: тот же ответ даёт число записей в заголовке. */
  data: ReturnType<typeof useMonthData>
  compact?: boolean
  onOpenDay: (date: string) => void
}) {
  const days = monthGridDays(month)
  const stats = monthStats(days, data.hours, data.appointments, data.timeOff)

  return (
    <div className={`month${compact ? ' compact' : ''}`}>
      {data.error && <p className="error" role="alert">{data.error.message}</p>}
      <div className="month-grid" role="group" aria-label="Дни месяца">
        {WEEKDAYS.map((w, i) => <div key={w} className={`month-weekday${i >= 5 ? ' weekend' : ''}`} aria-hidden="true">{w}</div>)}
        {days.map((date) => {
          const inMonth = date.startsWith(month)
          const s = inMonth ? stats.get(date) : undefined
          const pct = s?.load != null ? Math.round(s.load * 100) : null
          const label = [
            dayTitle(date),
            s?.off ? (s.offTitle ?? 'нерабочий день') : null,
            s ? (s.count ? recordsText(s.count) : 'записей нет') : null,
            s && pct != null && !s.off ? `занято ${pct}% рабочего времени` : null,
          ].filter(Boolean).join(', ')
          const cls = ['month-day', inMonth ? '' : 'other', s?.off ? 'off' : '', date === today ? 'today' : '', date === selected ? 'selected' : '',
            date < today ? 'past' : ''].filter(Boolean).join(' ')
          return (
            <button key={date} type="button" className={cls} aria-label={`${label}: открыть день`} aria-current={date === today ? 'date' : undefined}
              onClick={() => onOpenDay(date)}>
              <span className="month-head">
                <span className="month-num num">{Number(date.slice(8, 10))}</span>
                {s && s.count > 0 && <span className="month-count num">{compact ? s.count : recordsText(s.count)}</span>}
              </span>
              {s?.off && !compact && <span className="month-off">{s.offTitle ?? 'Выходной'}</span>}
              {s && s.count > 0 && !compact && (
                <span className="month-dots">
                  {MONTH_KINDS.filter((k) => s.kinds[k]).map((k) => (
                    <span key={k} className={`month-dot k-${k}`} title={`${s.kinds[k]} — ${KIND_TEXT[k]}`}>
                      <i aria-hidden="true" />{s.kinds[k]}
                    </span>
                  ))}
                </span>
              )}
              {s && pct != null && !s.off && (
                <span className="month-load" title={`Занято ${pct}% рабочего времени`} aria-hidden="true">
                  <span className={pct >= 85 ? 'full' : undefined} style={{ '--load': `${pct}%` } as CSSProperties} />
                </span>
              )}
            </button>
          )
        })}
      </div>
      {!compact && (
        <p className="month-legend hint small">
          {MONTH_KINDS.filter((k) => k !== 'quiet').map((k) => (
            <span key={k} className={`month-dot k-${k}`}><i aria-hidden="true" />{KIND_TEXT[k]}</span>
          ))}
          <span className="month-legend-load"><span aria-hidden="true" /> занято от рабочего времени</span>
          <span className="month-legend-off"><span aria-hidden="true" /> нерабочий день</span>
        </p>
      )}
      {data.pending && <Loading text="Загрузка месяца…" />}
    </div>
  )
}
