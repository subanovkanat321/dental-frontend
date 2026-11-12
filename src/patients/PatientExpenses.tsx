import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ExpenseEdit } from '../lib/ExpenseEdit'
import { shortDate, somText, todayIn } from '../lib/time'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']

const LAB = 'Зуботехническая лаборатория'

/**
 * Расходы по пациенту (техник, лаборатория): итог и список; «＋ Расход по пациенту» — сумма,
 * статья (по умолчанию лаборатория), комментарий. Расход попадает в «Кассу → Расходы». Есть в карточке
 * пациента и в карточке приёма. Кому можно — решает сервер (админ — на любого врача, врач — на себя).
 */
export function PatientExpenses({ patient, me, doctorId }: {
  patient: Patient
  me: Me
  /** Врач приёма: из карточки приёма расход записывается на него (админ); иначе — на себя. */
  doctorId?: number
}) {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: ['expenses', 'patient', patient.id],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/expenses', { params: { path: { patientId: patient.id } } })),
    retry: false,
  })
  const [open, setOpen] = useState(false)
  // Ошиблись — «изменить» у строки: сумма, статья, дата, комментарий или удалить
  const [editing, setEditing] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(LAB)
  const [comment, setComment] = useState('')
  const add = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/expenses', {
      body: {
        spentOn: todayIn(), amountSom: Number(amount), category: category.trim(), comment: comment.trim() || undefined,
        patientId: patient.id, doctorId: doctorId ?? me.doctorId ?? undefined,
      },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['expenses'] })
      setOpen(false)
      setAmount('')
      setComment('')
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }
  const items = list.data ?? []
  const total = items.reduce((sum, x) => sum + x.amountSom, 0)
  return (
    <div className="patient-expenses">
      {items.length > 0 && (
        <>
          <p className="hint">💸 Расходы по пациенту: <b className="num">{somText(total)}</b></p>
          <ul className="patient-expense-list" aria-label="Расходы по пациенту">
            {items.map((x) => (
              <li key={x.id}>
                {editing === x.id ? <ExpenseEdit expense={x} onDone={() => setEditing(null)} /> : (
                  <>
                    <span>{x.category} · <b className="num">{somText(x.amountSom)}</b>
                      <span className="hint"> · {x.spentOn ? shortDate(`${x.spentOn}T12:00:00Z`) : ''}{x.comment ? ` · ${x.comment}` : ''}</span></span>
                    <button type="button" className="link" onClick={() => setEditing(x.id)}>изменить</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {open ? (
        <form className="form sub-form" aria-label="Расход по пациенту" onSubmit={submit}>
          <label className="field"><span>Сумма, сом</span>
            <input type="number" min={1} inputMode="numeric" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field"><span>Статья</span>
            <input maxLength={60} required value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label className="field"><span>Комментарий (необязательно)</span>
            <input maxLength={200} placeholder="Например: коронка, 2 зуба" value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          {add.error && <p className="error" role="alert">{Object.values(add.error.fieldErrors)[0] ?? add.error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={add.isPending}>Добавить расход</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>💸 Расход по пациенту (техник)</button>
      )}
    </div>
  )
}
