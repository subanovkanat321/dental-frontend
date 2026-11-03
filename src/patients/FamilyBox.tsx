import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { RELATION } from '../lib/relations'
import { isAssistant, seesAllMoney } from '../lib/roles'
import { somText } from '../lib/time'

type Me = Schemas['BookingViewsMe']
type Patient = Schemas['PatientView']
type Method = NonNullable<Schemas['FamilyMoneyControllerPay']['method']>

const METHODS: [Method, string][] = [['CASH', 'Наличные'], ['TRANSFER', 'Перевод'], ['CARD', 'Карта']]

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «👨‍👩‍👧 Семья» в карточке пациента: кто в семье (нажать — карточка родственника), добавить
 * родственника, общий долг семьи и «Оплатить за семью» — одна сумма закрывает долги всех, старые
 * первыми. Деньги — тем, кто видит долги (регистратура, админ, врач — свои).
 */
export function FamilyBox({ patient, me, onOpenPatient }: { patient: Patient; me: Me; onOpenPatient?: (id: number) => void }) {
  const client = useQueryClient()
  const key = ['family', patient.id]
  const family = useQuery({
    queryKey: key,
    queryFn: async () => (await unwrap(api.GET('/api/patients/{id}/family', { params: { path: { id: patient.id! } } }))) ?? null,
  })
  const money = !isAssistant(me) && Boolean(me.reception || seesAllMoney(me) || me.doctorId != null)
  const familyId = family.data?.id
  const debts = useQuery({
    queryKey: ['debts', 'family', familyId],
    queryFn: () => unwrap(api.GET('/api/families/{id}/debts', { params: { path: { id: familyId! } } })),
    enabled: money && familyId != null,
  })
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState(false)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['family'] })
    void client.invalidateQueries({ queryKey: ['families'] })
  }
  const leave = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{id}/family', { params: { path: { id: patient.id! } } })),
    onSuccess: refresh,
  })
  if (family.isPending) return null
  const f = family.data
  const others = (f?.members ?? []).filter((m) => m.id !== patient.id)
  const total = (debts.data ?? []).reduce((s, d) => s + (d.debtSom ?? 0), 0)

  return (
    <section className="family-box" aria-label="Семья">
      <h3>👨‍👩‍👧 {f ? f.name : 'Семья'}</h3>
      {f ? (
        <>
          <div className="family-members">
            {others.map((m) => {
              // Добавлен родителем из бота — кем приходится: «Аружан · ребёнок»
              const label = m.relation ? `${m.fullName} · ${RELATION[m.relation]}` : m.fullName
              return onOpenPatient
                ? <button key={m.id} type="button" className="chip" onClick={() => onOpenPatient(m.id!)}>{label}</button>
                : <span key={m.id} className="chip">{label}</span>
            })}
          </div>
          {money && total > 0 && (
            <p className="tone-wait">Долг семьи: <b className="num">{somText(total)}</b>
              <span className="hint"> · приёмов: {debts.data?.length}</span></p>
          )}
          {money && total > 0 && !paying && (
            <button type="button" className="btn primary" onClick={() => setPaying(true)}>Оплатить за семью</button>
          )}
          {paying && familyId != null && <FamilyPay familyId={familyId} total={total} onDone={() => setPaying(false)} />}
        </>
      ) : <p className="hint">Мама платит за детей? Свяжите родственников — их долги будут видны вместе и закрываются одной оплатой.</p>}
      <div className="actions">
        {!adding && <button type="button" className="link" onClick={() => setAdding(true)}>＋ Добавить родственника</button>}
        {f && <button type="button" className="link" disabled={leave.isPending}
          onClick={() => window.confirm(`Убрать «${patient.fullName}» из семьи?`) && leave.mutate()}>Убрать из семьи</button>}
      </div>
      {adding && <AddRelative patient={patient} onDone={() => { setAdding(false); refresh() }} />}
      {leave.error && <p className="error" role="alert">{errorText(leave.error)}</p>}
    </section>
  )
}

/** Найти родственника по имени или номеру и добавить в семью. */
function AddRelative({ patient, onDone }: { patient: Patient; onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2,
  })
  const join = useMutation<unknown, ApiError, number>({
    mutationFn: (relativeId) => unwrap(api.POST('/api/patients/{id}/family', {
      params: { path: { id: patient.id! } }, body: { relativeId },
    })),
    onSuccess: onDone,
  })
  const list = (found.data ?? []).filter((p) => p.id !== patient.id).slice(0, 6)
  return (
    <div className="patient-pick">
      <input type="search" autoFocus aria-label="Найти родственника" placeholder="Имя или номер родственника" value={query}
        onChange={(e) => setQuery(e.target.value)} />
      {list.length > 0 && (
        <ul className="found">
          {list.map((p) => (
            <li key={p.id}><button type="button" disabled={join.isPending} onClick={() => join.mutate(p.id!)}>{p.fullName}</button></li>
          ))}
        </ul>
      )}
      {search.length >= 2 && found.isSuccess && !list.length && <p className="hint">Не нашли — сначала добавьте пациента в «Пациентах».</p>}
      {join.error && <p className="error" role="alert">{errorText(join.error)}</p>}
      <button type="button" className="link" onClick={onDone}>Отмена</button>
    </div>
  )
}

/** Одна оплата на всю семью: сумма (по умолчанию весь долг) и способ; сервер раскладывает сам. */
function FamilyPay({ familyId, total, onDone }: { familyId: number; total: number; onDone: () => void }) {
  const client = useQueryClient()
  const [amount, setAmount] = useState(String(total))
  const [method, setMethod] = useState<Method>('CASH')
  const pay = useMutation<Schemas['FamilyMoneyControllerPaid'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/families/{id}/pay', { params: { path: { id: familyId } }, body: { amountSom: Number(amount || 0), method } })),
    onSuccess: () => {
      for (const k of ['debts', 'patient-card', 'appointments', 'revenue', 'report', 'to-pay']) void client.invalidateQueries({ queryKey: [k] })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    pay.mutate()
  }
  if (pay.data) {
    return (
      <div className="family-paid" role="status">
        <p className="tone-ok">✅ Оплачено {somText(Number(amount))}:</p>
        <ul>{(pay.data.applied ?? []).map((x) => <li key={x.appointmentId}>{x.patient} — {somText(x.amountSom ?? 0)}</li>)}</ul>
        {(pay.data.leftDebtSom ?? 0) > 0 && <p className="hint">Осталось долга: {somText(pay.data.leftDebtSom ?? 0)}</p>}
        <button type="button" className="btn" onClick={onDone}>Готово</button>
      </div>
    )
  }
  return (
    <form className="form sub-form" aria-label="Оплата за семью" onSubmit={submit}>
      <label className="field"><span>Сумма, сом</span>
        <input inputMode="numeric" value={amount} autoFocus onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <div className="segments" role="group" aria-label="Способ оплаты">
        {METHODS.map(([m, t]) => <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>{t}</button>)}
      </div>
      <p className="hint">Закроет долги по порядку — сначала самые старые.</p>
      {pay.error && <p className="error" role="alert">{errorText(pay.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={pay.isPending || !Number(amount)}>Принять {amount ? somText(Number(amount)) : ''}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}
