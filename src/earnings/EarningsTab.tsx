import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { somText } from '../lib/time'
import { monthName, todayOf, useEarnings, type Earnings } from './earnings'
import { GoalBar } from './EarningsWidgets'
import { NetMonthBlock } from './NetMonthBlock'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']

const percentText = (p?: number) => `${String(Number(p ?? 0)).replace('.', ',')}%`

/** «+12%» / «−5%» / «как и было». */
function changeText(c: number): string {
  if (c === 0) return 'столько же'
  return `${c > 0 ? '+' : '−'}${Math.abs(c)}%`
}

/** «1 рабочий день», «3 рабочих дня», «9 рабочих дней». */
function workDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod100 >= 11 && mod100 <= 14 ? 'рабочих дней' : mod10 === 1 ? 'рабочий день' : mod10 >= 2 && mod10 <= 4 ? 'рабочих дня' : 'рабочих дней'
  return `${n} ${word}`
}

/**
 * «Касса → Мой заработок» — только своё: сегодня, за месяц (как «к выплате» в «Зарплате»), сравнение
 * с прошлым месяцем на ту же дату и личная цель на месяц. Аренда кресла (частный врач) — только в
 * месячной сумме, «на руки после аренды»; «сегодня» её не делим по дням. Цель и галочку «итог дня» видит и меняет
 * только сам врач. Все суммы считает сервер (GET /api/me/earnings).
 */
export function EarningsTab({ me }: { me: Me }) {
  const q = useEarnings(me)
  if (q.isPending) return <Loading />
  if (q.error) return <p className="error">{q.error.message}</p>
  return (
    <>
      <EarningsView e={q.data} />
      <NetMonthBlock me={me} />
    </>
  )
}

function EarningsView({ e }: { e: Earnings }) {
  const percent = Number(e.percent ?? 0)
  const month = monthName(e.month)
  const rent = e.rentSom
  const monthSom = e.monthSom
  return (
    <>
      <section className="card-block earnings" aria-label="Мой заработок">
        <h2>Мой заработок</h2>
        <dl className="salary-sums">
          <div>
            <dt>{percent > 0 || !e.hasTerms ? 'Сегодня' : 'Сегодня принято'}</dt>
            <dd className="num strong" aria-label="Сегодня">{somText(todayOf(e))}</dd>
          </div>
          <div>
            <dt>{rent > 0 ? `За ${month}, на руки после аренды` : `За ${month}`}</dt>
            <dd className={`num strong${monthSom < 0 ? ' tone-bad' : ''}`} aria-label="За месяц">{monthSom < 0 ? `−${somText(-monthSom)}` : somText(monthSom)}</dd>
          </div>
        </dl>
        {!e.hasTerms ? (
          <>
            <p className="hint">Принято от ваших пациентов: сегодня {somText(e.todayRevenueSom)}, за {month} {somText(e.monthRevenueSom)}.</p>
            <p className="hint small">Процент задаёт руководитель в «Касса → Зарплата» — тогда здесь будет ваш заработок.</p>
          </>
        ) : (
          <p className="hint">
            {percent > 0 ? `Сегодня — ${percentText(e.percent)} от принятых ${somText(e.todayRevenueSom)}. ` : 'Оклад — в итоге месяца, по дням его не делим. '}
            За {month} — {[e.baseSom ? `оклад ${somText(e.baseSom)}` : '', percent > 0 ? `${percentText(e.percent)} от ${somText(e.monthRevenueSom)}` : '']
              .filter(Boolean).join(' + ')}{rent > 0 ? ` − аренда кресла ${somText(rent)}` : ''}, как «к выплате» в «Зарплате».
          </p>
        )}
        {rent > 0 && (
          <p className="hint small" aria-label="Аренда">
            Аренда {somText(rent)} за месяц вычтена из суммы за {month}; в «сегодня» её нет — по дням не делим.
            {monthSom < 0 && ` Пока аренда больше заработка: вы должны клинике ${somText(-monthSom)}.`}
          </p>
        )}
        {e.changePercent != null && (
          <p className="compare" aria-label="Сравнение с прошлым месяцем">
            Как в прошлом месяце к этой дате: <b className={e.changePercent > 0 ? 'tone-ok' : 'tone-quiet'}>{changeText(e.changePercent)}</b>
            <span className="hint"> · было {somText(e.previousMonthSom)}</span>
          </p>
        )}
      </section>
      <GoalBlock e={e} />
    </>
  )
}

/** Цель на месяц: прогресс, «осталось», «в день нужно ≈» и форма. */
function GoalBlock({ e }: { e: Earnings }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(e.goalSom ? String(e.goalSom) : '')
  const put = (data: Earnings) => client.setQueryData(['earnings'], data)
  const goal = useMutation<Earnings, ApiError, number | null>({
    mutationFn: (goalSom) => unwrap(api.PUT('/api/me/earnings/goal', { body: { goalSom: goalSom ?? undefined } })),
    onSuccess: (data) => {
      put(data)
      setEditing(false)
      setValue(data.goalSom ? String(data.goalSom) : '')
    },
  })
  const evening = useMutation<Earnings, ApiError, boolean>({
    mutationFn: (eveningSummary) => unwrap(api.PUT('/api/me/earnings/evening', { body: { eveningSummary } })),
    onSuccess: put,
  })
  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    goal.mutate(value ? Number(value) : null)
  }
  const left = e.goalLeftSom ?? 0
  const showForm = editing || !e.goalSom
  return (
    <section className="card-block earnings-goal" aria-label="Цель на месяц">
      <h2>Цель на месяц</h2>
      {e.goalSom ? (
        <>
          <p className="earn-goal-line"><b className="num">{somText(e.monthSom)}</b> <span className="hint">из {somText(e.goalSom)}</span></p>
          <GoalBar e={e} />
          {left > 0 ? (
            <p aria-label="До цели">
              До цели осталось <b className="num">{somText(left)}</b>
              {e.perDayNeededSom != null
                ? <> · в день нужно ≈ <b className="num">{somText(e.perDayNeededSom)}</b> <span className="hint">на {workDays(e.workDaysLeft)}, считая сегодня</span></>
                : <span className="hint"> · рабочих дней в этом месяце больше нет</span>}
            </p>
          ) : <p className="tone-ok" aria-label="До цели">Цель месяца достигнута</p>}
          <p className="hint small">Цель видите только вы.</p>
        </>
      ) : <p className="hint">Поставьте себе цель — покажем, сколько осталось и сколько нужно в день. Её видите только вы.</p>}
      {showForm ? (
        <form className="row" onSubmit={submit}>
          <label className="field"><span>Цель, сом</span>
            <input inputMode="numeric" value={value} placeholder="например, 250000" onChange={(ev) => setValue(ev.target.value.replace(/\D/g, ''))} />
          </label>
          <button type="submit" className="btn primary" disabled={goal.isPending || !value}>Сохранить цель</button>
          {editing && <button type="button" className="btn" onClick={() => setEditing(false)}>Отмена</button>}
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}>Изменить цель</button>
          <button type="button" className="btn quiet" onClick={() => goal.mutate(null)} disabled={goal.isPending}>Убрать цель</button>
        </div>
      )}
      {goal.error && <p className="error">{goal.error.fieldErrors.goalSom ?? goal.error.message}</p>}
      <label className="check">
        <input type="checkbox" checked={e.eveningSummary !== false} disabled={evening.isPending}
          onChange={(ev) => evening.mutate(ev.target.checked)} /> Присылать итог дня в вечерней сводке
      </label>
      {evening.error && <p className="error">{evening.error.message}</p>}
    </section>
  )
}
