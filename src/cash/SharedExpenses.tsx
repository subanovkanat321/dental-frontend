import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ExpenseEdit } from '../lib/ExpenseEdit'
import { monthRange, shortDate, somText } from '../lib/time'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { splitTitle } from './expenses'

type Me = Schemas['BookingViewsMe']
type Expense = Schemas['ExpensesExpense']

/**
 * «Общие расходы клиники» за месяц: аренда кабинета, коммуналка — с ключом деления и долями всех врачей
 * (при «врачи работают независимо» их видит любой врач: это общие деньги). Своя доля выделена; итог —
 * сколько из общих расходов приходится на меня. «Повторять каждый месяц» можно выключить здесь же.
 */
export function SharedExpenses({ month, me }: { month: string; me: Me }) {
  const client = useQueryClient()
  const range = monthRange(month)
  const list = useQuery({
    queryKey: ['expenses', 'shared', month],
    queryFn: () => unwrap(api.GET('/api/expenses/shared', { params: { query: range } })),
  })
  const [editing, setEditing] = useState<number | null>(null)
  const stopRepeat = useMutation<unknown, ApiError, Expense>({
    mutationFn: (x) => unwrap(api.PUT('/api/expenses/{id}', {
      params: { path: { id: x.id } },
      body: { amountSom: x.amountSom, category: x.category, spentOn: x.spentOn, comment: x.comment, repeatMonthly: false },
    })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['expenses'] }),
  })
  const rows = list.data ?? []
  const total = rows.reduce((s, x) => s + x.amountSom, 0)
  const mine = me.doctorId == null ? null
    : rows.reduce((s, x) => s + (x.shares ?? []).filter((d) => d.doctorId === me.doctorId).reduce((a, d) => a + d.amountSom, 0), 0)

  return (
    <section className="card-block" aria-label="Общие расходы клиники">
      <h2>Общие расходы клиники {rows.length > 0 && `· ${somText(total)}`}</h2>
      {mine != null && rows.length > 0 && <p className="hint">Ваша доля за месяц: <b className="num">{somText(mine)}</b> — она в «Мой заработок» → «Чистыми».</p>}
      {list.isPending ? <Loading /> : list.error ? <p className="error">{list.error.message}</p> : !rows.length ? (
        <EmptyState compact title="Общих расходов за месяц нет">Аренда кабинета, коммуналка, уборка — «Общий расход клиники» в форме выше: запишется один раз и разделится между врачами.</EmptyState>
      ) : (
        <ul className="shared-list" aria-label="Общие расходы">
          {rows.map((x) => (
            <li key={x.id}>
              <div className="shared-head">
                <span><b>{x.category}</b> · <b className="num">{somText(x.amountSom)}</b>
                  <span className="hint"> · {x.spentOn ? shortDate(`${x.spentOn}T12:00:00Z`) : ''} · {splitTitle(x.splitKey).toLowerCase()}
                    {x.comment ? ` · ${x.comment}` : ''}</span></span>
                <span className="nowrap">
                  {x.repeatMonthly && (
                    <button type="button" className="chip" title="Повторяется 1-го числа каждого месяца. Нажмите — больше не повторять"
                      disabled={stopRepeat.isPending} onClick={() => stopRepeat.mutate(x)}>каждый месяц ✕</button>
                  )}
                  <button type="button" className="btn small ghost" aria-label={`Исправить общий расход: ${x.category} ${x.amountSom}`}
                    onClick={() => setEditing(editing === x.id ? null : x.id)}>✎</button>
                </span>
              </div>
              <p className="shares" aria-label={`Доли: ${x.category}`}>
                {(x.shares ?? []).map((d) => (
                  <span key={d.doctorId} className={d.doctorId === me.doctorId ? 'chip mine' : 'chip'}>{d.doctor}: {somText(d.amountSom)}</span>
                ))}
                {!(x.shares ?? []).length && <span className="hint small">делить пока не на кого</span>}
              </p>
              {editing === x.id && <ExpenseEdit expense={x} onDone={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}
      {stopRepeat.error && <p className="error">{Object.values(stopRepeat.error.fieldErrors)[0] ?? stopRepeat.error.message}</p>}
    </section>
  )
}
