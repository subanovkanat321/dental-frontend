import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from './confirm'
import { DateInput } from '../layout/DateInput'
import { todayIn } from './time'

type Expense = Schemas['ExpensesExpense']

/**
 * Исправить или удалить расход (ошиблись суммой или статьёй, отметили не тот): сумма, статья, дата,
 * комментарий; врач и пациент остаются. Права и «выплату зарплаты меняют в «Зарплате»» решает сервер —
 * его ответ показываем. Общая форма для «Касса → Расходы» и расходов по пациенту.
 */
export function ExpenseEdit({ expense: x, onDone }: { expense: Expense; onDone: () => void }) {
  const client = useQueryClient()
  const [amount, setAmount] = useState(String(x.amountSom))
  const [category, setCategory] = useState(x.category ?? '')
  const [spentOn, setSpentOn] = useState(x.spentOn ?? todayIn())
  const [comment, setComment] = useState(x.comment ?? '')
  const done = () => {
    void client.invalidateQueries({ queryKey: ['expenses'] })
    void client.invalidateQueries({ queryKey: ['spending'] })
    void client.invalidateQueries({ queryKey: ['net-month'] })
    onDone()
  }
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/expenses/{id}', {
      params: { path: { id: x.id } },
      body: { amountSom: Number(amount), category: category.trim(), spentOn, comment: comment.trim() || undefined },
    })),
    onSuccess: done,
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/expenses/{id}', { params: { path: { id: x.id } } })),
    onSuccess: done,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const error = save.error ?? remove.error
  return (
    <form className="form sub-form" aria-label="Исправить расход" onSubmit={submit}>
      <label className="field"><span>Сумма, сом</span>
        <input type="number" min={1} inputMode="numeric" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field"><span>Статья</span>
        <input maxLength={40} required value={category} onChange={(e) => setCategory(e.target.value)} /></label>
      <label className="field"><span>Дата</span>
        <DateInput value={spentOn} max={todayIn()} required onChange={(e) => setSpentOn(e.target.value)} /></label>
      <label className="field"><span>Комментарий (необязательно)</span>
        <input maxLength={200} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
        <button type="button" className="btn danger" disabled={remove.isPending}
          onClick={() => void ask('Удалить расход? Он пропадёт из «Расходов» и расчётов.').then((ok) => ok && remove.mutate())}>Удалить расход</button>
      </div>
    </form>
  )
}
