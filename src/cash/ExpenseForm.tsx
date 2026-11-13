import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { canShareExpenses, seesAllMoney } from '../lib/roles'
import { somText, todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'
import { MATERIALS, MATERIALS_HINT, SPLIT_KEYS, useCategories } from './expenses'
import { Select } from '../layout/Select'

type Me = Schemas['BookingViewsMe']

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * Статья расхода: список готовых и своих + «Другое — своя статья». Одна для «Касса → Расходы», «＋ Расход»
 * в «Деньгах» и расходов по пациенту — статьи не расходятся на «лаборатория» и «Лаборатория».
 */
export function CategoryPick({ value, other, onChange, onOther }: {
  value: string
  other: string
  onChange: (v: string) => void
  onOther: (v: string) => void
}) {
  const categories = useCategories()
  const cats = [...(categories.data?.standard ?? []), ...(categories.data?.own ?? [])]
  return (
    <>
      <Select aria-label="Статья" required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Статья…</option>
        {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="*">Другое — своя статья</option>
      </Select>
      {value === '*' && <input aria-label="Своя статья" placeholder="Например: реклама" required maxLength={40} value={other} onChange={(e) => onOther(e.target.value)} />}
      {value === MATERIALS && <p className="hint small expense-hint" role="note">{MATERIALS_HINT}</p>}
    </>
  )
}

/**
 * Новый расход: дата, сумма, статья, комментарий, пациент (необязательно). Кому можно — «Общий расход
 * клиники» (аренда кабинета, коммуналка): как делить и «повторять каждый месяц»; у «Вручную» — суммы
 * по врачам с остатком. Записать расход на себя или на врача (админ) — как раньше; доли и права считает
 * сервер.
 */
export function ExpenseForm({ me, doctorId, patientPick, shared: sharedDefault = false, onDone }: {
  me: Me
  /** Админ смотрит кассу одного врача — расход запишется на него */
  doctorId?: number | null
  /** Поле «Пациент — необязательно» (в «Расходах»), в окне «＋ Расход» не нужно */
  patientPick?: (value: { id: number; fullName: string } | null, onChange: (p: { id: number; fullName: string } | null) => void) => React.ReactNode
  shared?: boolean
  onDone?: () => void
}) {
  const client = useQueryClient()
  const canShare = canShareExpenses(me)
  const [form, setForm] = useState({ spentOn: todayIn(), amount: '', category: '', other: '', comment: '' })
  const [patient, setPatient] = useState<{ id: number; fullName: string } | null>(null)
  const [shared, setShared] = useState(canShare && sharedDefault)
  const [splitKey, setSplitKey] = useState('CHAIRS')
  const [repeat, setRepeat] = useState(false)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const [manual, setManual] = useState<Record<number, string>>({})
  const amount = Number(form.amount) || 0
  const manualSum = doctors.reduce((s, d) => s + (Number(manual[d.id]) || 0), 0)

  const add = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/expenses', {
      body: {
        spentOn: form.spentOn, amountSom: amount, category: form.category === '*' ? form.other.trim() : form.category,
        comment: form.comment.trim() || undefined,
        ...(shared
          ? {
            splitKey, repeatMonthly: repeat,
            shares: splitKey === 'MANUAL' ? doctors.map((d) => ({ doctorId: d.id, amountSom: Number(manual[d.id]) || 0 })) : undefined,
          }
          : { doctorId: doctorId ?? undefined, patientId: patient?.id }),
      },
    })),
    onSuccess: () => {
      setForm({ ...form, amount: '', comment: '', other: '' })
      setPatient(null)
      setManual({})
      void client.invalidateQueries({ queryKey: ['expenses'] })
      void client.invalidateQueries({ queryKey: ['expense-categories'] })
      void client.invalidateQueries({ queryKey: ['spending'] })
      void client.invalidateQueries({ queryKey: ['net-month'] })
      onDone?.()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }

  return (
    <form className="expense-form" aria-label="Новый расход" onSubmit={submit}>
      {canShare && (
        <div className="segments expense-kind" role="group" aria-label="Чей расход">
          <button type="button" aria-pressed={!shared} onClick={() => setShared(false)}>{seesAllMoney(me) ? 'Расход' : 'Мой расход'}</button>
          <button type="button" aria-pressed={shared} onClick={() => setShared(true)}>Общий расход клиники</button>
        </div>
      )}
      <DateInput aria-label="Когда" value={form.spentOn} max={todayIn()} required onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
      <input type="number" aria-label="Сумма, сом" placeholder="Сумма, сом" min={1} inputMode="numeric" required value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      <CategoryPick value={form.category} other={form.other} onChange={(v) => setForm({ ...form, category: v })} onOther={(v) => setForm({ ...form, other: v })} />
      <input aria-label="Комментарий" placeholder="Комментарий — необязательно" maxLength={200} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
      {!shared && patientPick?.(patient, setPatient)}
      {shared && (
        <fieldset className="split-box">
          <legend>Как делить</legend>
          <Select aria-label="Как делить" value={splitKey} onChange={(e) => setSplitKey(e.target.value)}>
            {SPLIT_KEYS.map(([k, title]) => <option key={k} value={k}>{title}</option>)}
          </Select>
          <p className="hint small">{SPLIT_KEYS.find(([k]) => k === splitKey)?.[2]}. Доля каждого врача — в его «Чистыми за месяц».</p>
          {splitKey === 'MANUAL' && (
            <div className="split-manual">
              {doctors.map((d) => (
                <label key={d.id} className="field inline">
                  <span>{d.fullName}</span>
                  <input type="number" min={0} inputMode="numeric" aria-label={`Доля: ${d.fullName}`} value={manual[d.id] ?? ''}
                    onChange={(e) => setManual({ ...manual, [d.id]: e.target.value })} />
                </label>
              ))}
              <p className={`small ${manualSum === amount ? 'tone-ok' : 'tone-wait'}`} aria-label="Распределено">
                Распределено {somText(manualSum)} из {somText(amount)}{manualSum !== amount ? ` · осталось ${somText(amount - manualSum)}` : ''}
              </p>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            <span>Повторять каждый месяц <span className="hint small">— встанет сам 1-го числа (аренда)</span></span>
          </label>
        </fieldset>
      )}
      <button type="submit" className="btn primary" disabled={add.isPending || (shared && splitKey === 'MANUAL' && manualSum !== amount)}>
        {shared ? 'Записать общий расход' : 'Добавить'}
      </button>
      {add.error && <p className="error" role="alert">{errorText(add.error)}</p>}
    </form>
  )
}
