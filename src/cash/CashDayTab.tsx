import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { addDays, shortDate, somText, timeOf, todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { HeadTools } from '../layout/PageHead'
import { Loading } from '../layout/Loading'
import { PrintSheet } from '../print/PrintSheet'
import { docDate } from '../print/paper'
import { ExpenseDialog } from './ExpenseDialog'

type Me = Schemas['BookingViewsMe']
type Day = Schemas['CashDaysView']
type Kind = NonNullable<Schemas['CashDaysMovement']['kind']>

const METHODS: [string, string][] = [['CASH', 'Наличные'], ['TRANSFER', 'Перевод'], ['CARD', 'Карта']]
const METHOD_TEXT: Record<string, string> = { TRANSFER: 'переводом', CARD: 'на карту' }

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/** «−1 200 сом» для отрицательного остатка (недостача), иначе «1 200 сом». */
const signed = (n: number) => (n < 0 ? `−${somText(-n)}` : somText(n))

/**
 * «Касса → Касса дня» (шаг 3Б): наличные в ящике за выбранный день — остаток на начало, приход по способам (в ящик —
 * только наличные), расходы из кассы, внесение и изъятие, остаток на конец. Считает сервер (GET /api/cash-day);
 * руководитель вписывает остаток, записывает внесение/изъятие с причиной, закрывает и открывает день.
 */
export function CashDayTab({ me }: { me: Me }) {
  const [day, setDay] = useState(todayIn())
  const client = useQueryClient()
  const cash = useQuery({
    queryKey: ['cash-day', day],
    queryFn: () => unwrap(api.GET('/api/cash-day', { params: { query: { day } } })),
  })
  const admin = Boolean(me.admin)
  const [form, setForm] = useState<Kind | 'OPENING' | null>(null)
  const [expense, setExpense] = useState(false)
  const [printing, setPrinting] = useState(false)
  const put = (d: Day) => client.setQueryData(['cash-day', day], d)
  // Остаток на начало следующих дней зависит от этого — их кэш устарел
  const done = (d: Day) => {
    void client.invalidateQueries({ queryKey: ['cash-day'] })
    put(d)
    setForm(null)
  }
  const close = useMutation<Day, ApiError, void>({
    mutationFn: () => unwrap(api.POST('/api/cash-day/close', { body: { day } })),
    onSuccess: done,
  })
  const reopen = useMutation<Day, ApiError, void>({
    mutationFn: () => unwrap(api.POST('/api/cash-day/reopen', { body: { day } })),
    onSuccess: done,
  })
  const remove = useMutation<Day, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/cash-day/movements/{id}', { params: { path: { id } } })),
    onSuccess: done,
  })
  const today = todayIn()
  const d = cash.data
  const error = errorText(close.error ?? reopen.error ?? remove.error)

  return (
    <section className="card-block cash-day" aria-label="Касса дня">
      <HeadTools>
        <div className="day-step" role="group" aria-label="День кассы">
          <button type="button" className="btn ghost small" aria-label="Предыдущий день" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <DateInput weekday aria-label="День" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button type="button" className="btn ghost small" aria-label="Следующий день" disabled={day >= today}
            onClick={() => setDay(addDays(day, 1))}>›</button>
          {day !== today && <button type="button" className="chip" onClick={() => setDay(today)}>Сегодня</button>}
        </div>
      </HeadTools>
      {cash.isPending ? <Loading /> : cash.error ? <p className="error" role="alert">{cash.error.message}</p> : d && (
        <>
          <dl className="cash-day-sum" aria-label="Итог кассы дня">
            <div>
              <dt><span className="cash-sign" aria-hidden="true" />Было утром</dt>
              <dd>{d.openingSom != null ? signed(d.openingSom) : <span className="tone-wait">не указано</span>}
                <span className="hint small">{d.openingSource === 'MANUAL' ? 'вписан' : d.openingSource === 'PREVIOUS' && d.openingFrom
                  ? `с ${shortDate(`${d.openingFrom}T12:00:00Z`)}` : ''}</span></dd>
            </div>
            <div>
              <dt><span className="cash-sign" aria-hidden="true">+</span>Оплаты наличными</dt>
              <dd>{somText(d.cashInSom)}</dd>
            </div>
            <div>
              <dt><span className="cash-sign" aria-hidden="true">−</span>Расходы наличными</dt>
              <dd>{somText(d.expensesSom)}</dd>
            </div>
            {d.cashRefundsSom > 0 && (
              <div>
                <dt><span className="cash-sign" aria-hidden="true">−</span>Возвраты аванса</dt>
                <dd>{somText(d.cashRefundsSom)}</dd>
              </div>
            )}
            <div>
              <dt><span className="cash-sign" aria-hidden="true">+</span>Положили в кассу</dt>
              <dd>{somText(d.depositsSom)}</dd>
            </div>
            <div>
              <dt><span className="cash-sign" aria-hidden="true">−</span>Забрали из кассы</dt>
              <dd>{somText(d.withdrawalsSom)}</dd>
            </div>
            <div className={`cash-day-total${d.closingSom < 0 ? ' tone-bad' : ''}`}>
              <dt><span className="cash-sign" aria-hidden="true">=</span>Должно быть в кассе</dt>
              <dd aria-label="Остаток на конец">{signed(d.closingSom)}</dd>
            </div>
          </dl>
          <p className="hint small cash-day-methods" aria-label="Приход по способам">
            Приход всего: <b className="num">{somText(d.inSom)}</b>
            {METHODS.map(([k, t]) => (d.inByMethod?.[k] ? ` · ${t.toLowerCase()} ${somText(d.inByMethod[k]!)}` : '')).join('')}
            {d.inSom > d.cashInSom && ' — в ящик идут только наличные'}
          </p>
          {/* Первый раз: сразу поле «сколько было утром» — без отдельной кнопки и формы ниже */}
          {d.openingSom == null && !d.closed && (admin
            ? <OpeningForm day={day} current={d} onDone={done} first />
            : <p className="cash-day-note" role="note">Сколько денег было в кассе утром, вписывает руководитель — дальше будет переходить с прошлого дня сам.</p>)}

          {d.closed ? (
            <div className="cash-day-closed">
              <p>🔒 День закрыт{d.closedAt ? ` ${shortDate(d.closedAt)} в ${timeOf(d.closedAt)}` : ''}{d.closedBy ? ` · ${d.closedBy}` : ''}
                {d.closedSom != null && <> · остаток <b className="num">{signed(d.closedSom)}</b></>}</p>
              {d.closedSom != null && d.closedSom !== d.closingSom && (
                <p className="tone-wait small">После закрытия изменилось: было {signed(d.closedSom)}, сейчас {signed(d.closingSom)}.
                  Следующий день начнётся с суммы закрытия.</p>
              )}
              {admin && <button type="button" className="btn small" disabled={reopen.isPending} onClick={() => void ask(
                'Открыть день снова? Можно будет исправить внесения, изъятия и остаток, потом закройте день ещё раз.', { ok: 'Открыть день' })
                .then((ok) => ok && reopen.mutate())}>Открыть день</button>}
            </div>
          ) : admin && (
            <>
              {/* Понятные действия с подписью «когда» вместо «Внесение / Изъятие» (2026-11-20, просьба владельца) */}
              <div className="cash-day-actions" role="group" aria-label="Действия с кассой">
                <button type="button" className="cash-act" onClick={() => setForm('IN')}>
                  <span className="cash-act-title">+ Положить в кассу</span><span className="cash-act-hint">размен, деньги руководителя</span></button>
                <button type="button" className="cash-act" onClick={() => setForm('OUT')}>
                  <span className="cash-act-title">− Забрать из кассы</span><span className="cash-act-hint">сдали в банк, забрал руководитель</span></button>
                <button type="button" className="cash-act" onClick={() => setExpense(true)}>
                  <span className="cash-act-title">− Расход наличными</span><span className="cash-act-hint">купили материалы, такси, вода…</span></button>
                {d.openingSom != null && (
                  <button type="button" className="cash-act" onClick={() => setForm('OPENING')}>
                    <span className="cash-act-title">✎ Было утром</span><span className="cash-act-hint">исправить сумму на начало дня</span></button>
                )}
              </div>
              <div className="cash-day-close">
                <button type="button" className="btn primary" disabled={close.isPending} onClick={() => void ask(
                  `Закрыть кассу за ${docDate(`${day}T12:00:00Z`)}? В кассе должно быть ${signed(d.closingSom)} — пересчитайте наличные. Закрытый день не правят, пока руководитель не откроет его снова.`,
                  { ok: 'Закрыть день' }).then((ok) => ok && close.mutate())}>Закрыть день</button>
                <span className="hint small">В конце дня пересчитайте наличные — должно быть {signed(d.closingSom)}</span>
              </div>
            </>
          )}
          {form === 'IN' || form === 'OUT'
            ? <MovementForm day={day} kind={form} onDone={done} onCancel={() => setForm(null)} />
            : form === 'OPENING' ? <OpeningForm day={day} current={d} onDone={done} onCancel={() => setForm(null)} /> : null}
          {error && <p className="error" role="alert">{error}</p>}

          <h3>Положили и забрали</h3>
          {d.movements?.length ? (
            <ul className="cash-day-list" aria-label="Положили и забрали">
              {d.movements.map((m) => (
                <li key={m.id}>
                  <span className="when num">{m.at ? timeOf(m.at) : ''}</span>
                  <span className="what">{m.kind === 'IN' ? 'Положили' : 'Забрали'} · {m.reason}{m.by ? <span className="hint"> · {m.by}</span> : null}</span>
                  <span className={`sum num${m.kind === 'OUT' ? ' tone-bad' : ''}`}>{m.kind === 'OUT' ? '−' : '+'}{somText(m.amountSom)}</span>
                  {admin && !d.closed && (
                    <button type="button" className="btn ghost small" aria-label={`Удалить: ${m.reason}`} disabled={remove.isPending}
                      onClick={() => void ask(`Удалить «${m.reason}» на ${somText(m.amountSom)}?`, { ok: 'Удалить' }).then((ok) => ok && remove.mutate(m.id))}>✕</button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="hint small">Не было</p>}

          <h3>Расходы наличными</h3>
          {d.expenses?.length ? (
            <ul className="cash-day-list" aria-label="Расходы наличными">
              {d.expenses.map((e) => (
                <li key={e.id}>
                  <span className="what">{e.category}{e.comment ? <span className="hint"> · {e.comment}</span> : null}</span>
                  <span className="sum num tone-bad">−{somText(e.amountSom)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="hint small">Не было.</p>}

          {/* Возвраты аванса пациентам (V243): наличные — из ящика, перевод и карта — только для сведения */}
          {(d.refunds?.length ?? 0) > 0 && (
            <>
              <h3>Возвраты аванса</h3>
              <ul className="cash-day-list" aria-label="Возвраты аванса">
                {d.refunds!.map((r) => (
                  <li key={r.id}>
                    <span className="when num">{r.at ? timeOf(r.at) : ''}</span>
                    <span className="what">{r.patient} · {r.reason}{r.method !== 'CASH' ? <span className="hint"> · {METHOD_TEXT[r.method ?? ''] ?? r.method}, не из ящика</span> : null}
                      {r.by ? <span className="hint"> · {r.by}</span> : null}</span>
                    <span className="sum num tone-bad">−{somText(r.amountSom)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button type="button" className="link" onClick={() => setPrinting(true)}>🖨 Печать отчёта</button>
          {printing && (
            <PrintSheet title="Касса за день" onClose={() => setPrinting(false)}>
              {() => <CashDaySheet d={d} />}
            </PrintSheet>
          )}
        </>
      )}
      {expense && <ExpenseDialog me={me} fromCash day={day} onClose={() => setExpense(false)} />}
    </section>
  )
}

function MovementForm({ day, kind, onDone, onCancel }: { day: string; kind: Kind; onDone: (d: Day) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const save = useMutation<Day, ApiError, void>({
    mutationFn: () => unwrap(api.POST('/api/cash-day/movements', {
      body: { day, kind, amountSom: amount === '' ? undefined : Number(amount), reason: reason.trim() },
    })),
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const title = kind === 'IN' ? 'Положить в кассу' : 'Забрать из кассы'
  return (
    <form className="pay-form cash-day-form" aria-label={title} onSubmit={submit}>
      <b>{title}</b>
      <label className="field"><span>Сумма, сом</span>
        <input type="number" min={1} inputMode="numeric" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field"><span>Причина</span>
        <input required maxLength={200} autoComplete="off" value={reason}
          placeholder={kind === 'IN' ? 'Размен, деньги руководителя…' : 'Сдали в банк, забрал руководитель…'}
          onChange={(e) => setReason(e.target.value)} /></label>
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
      <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
      <button type="button" className="link" onClick={onCancel}>Отмена</button>
    </form>
  )
}

function OpeningForm({ day, current, onDone, onCancel, first = false }: { day: string; current: Day; onDone: (d: Day) => void; onCancel?: () => void; first?: boolean }) {
  const [amount, setAmount] = useState(current.openingSom != null && current.openingSom >= 0 ? String(current.openingSom) : '')
  const save = useMutation<Day, ApiError, number | null>({
    mutationFn: (som) => unwrap(api.PUT('/api/cash-day/opening', { body: { day, amountSom: som ?? undefined } })),
    onSuccess: onDone,
  })
  return (
    <form className="pay-form cash-day-form" aria-label="Остаток на начало" onSubmit={(e) => { e.preventDefault(); save.mutate(Number(amount)) }}>
      <b>{first ? 'Сколько денег было в кассе утром?' : 'Было утром'}</b>
      <p className="hint small">{first ? 'Один раз — дальше сумма будет переходить с прошлого дня сама.' : 'Сколько наличных было в кассе в начале дня — пересчитайте деньги.'}</p>
      <label className="field"><span>Сумма, сом</span>
        <input type="number" min={0} inputMode="numeric" required autoFocus={!first} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
      <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
      {current.openingSource === 'MANUAL' && (
        <button type="button" className="link" disabled={save.isPending} onClick={() => save.mutate(null)}>Считать от прошлого дня</button>
      )}
      {onCancel && <button type="button" className="link" onClick={onCancel}>Отмена</button>}
    </form>
  )
}

/** Отчёт кассы за день на бумагу — те же строки, что на экране. */
function CashDaySheet({ d }: { d: Day }) {
  return (
    <>
      <h1>Касса за {docDate(`${d.day}T12:00:00Z`)}</h1>
      <table aria-label="Касса за день">
        <tbody>
          <tr><td>Было утром</td><td className="r">{d.openingSom != null ? signed(d.openingSom) : 'не указано'}</td></tr>
          {METHODS.map(([k, t]) => <tr key={k}><td>Приход: {t.toLowerCase()}</td><td className="r">{somText(d.inByMethod?.[k] ?? 0)}</td></tr>)}
          <tr><td>Расходы наличными</td><td className="r">−{somText(d.expensesSom)}</td></tr>
          {d.cashRefundsSom > 0 && <tr><td>Возвраты аванса наличными</td><td className="r">−{somText(d.cashRefundsSom)}</td></tr>}
          <tr><td>Положили в кассу</td><td className="r">{somText(d.depositsSom)}</td></tr>
          <tr><td>Забрали из кассы</td><td className="r">−{somText(d.withdrawalsSom)}</td></tr>
          <tr><td><b>Должно быть в кассе (наличные)</b></td><td className="r"><b>{signed(d.closingSom)}</b></td></tr>
        </tbody>
      </table>
      {(d.movements?.length ?? 0) > 0 && (
        <ul className="payments" aria-label="Положили и забрали">
          {d.movements!.map((m) => <li key={m.id}>{m.kind === 'IN' ? 'Положили' : 'Забрали'} · {somText(m.amountSom)} · {m.reason}{m.by ? ` · ${m.by}` : ''}</li>)}
        </ul>
      )}
      {d.closed && <p>День закрыт{d.closedBy ? `: ${d.closedBy}` : ''}{d.closedAt ? `, ${docDate(d.closedAt)} ${timeOf(d.closedAt)}` : ''}</p>}
      <div className="signatures"><span>Кассу сдал ____________________</span><span>Кассу принял ____________________</span></div>
    </>
  )
}
