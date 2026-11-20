import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { refundsAdvance, takesAdvance } from '../lib/roles'
import { shortDate, somText } from '../lib/time'
import { useAdvance, type Advance } from './advance'

type Me = Schemas['BookingViewsMe']
type Entry = Schemas['AdvancesEntry']
type Method = 'CASH' | 'TRANSFER' | 'CARD'

const METHODS: [Method, string][] = [['CASH', 'Наличные'], ['TRANSFER', 'Перевод'], ['CARD', 'Карта']]
const METHOD_TEXT: Record<string, string> = { CASH: 'наличными', TRANSFER: 'переводом', CARD: 'картой' }

function errorText(e: ApiError | null): string | null {
  return e ? e.fieldErrors.amountSom ?? e.fieldErrors.method ?? e.fieldErrors.reason ?? e.fieldErrors.comment ?? e.message : null
}

/** Строка истории словами: «Внесли наличными · на брекеты», «Оплата приёма 20.11», «Вернули: переехал». */
function entryText(e: Entry): string {
  const how = e.method ? ` ${METHOD_TEXT[e.method] ?? ''}` : ''
  switch (e.kind) {
    case 'IN': return `Внесли${how}${e.comment ? ` · ${e.comment}` : ''}`
    case 'REFUND': return `Вернули${how}${e.comment ? ` · ${e.comment}` : ''}`
    case 'SPEND': return `Оплата приёма${e.appointmentStartAt ? ` ${shortDate(e.appointmentStartAt)}` : ''}`
    default: return e.deltaSom > 0 ? 'Перенос в семье' : 'Ушёл из семьи — аванс остался семье'
  }
}

/**
 * «👛 Аванс» во вкладке «Деньги» карточки пациента (V243): остаток счёта (семьи — общий), «＋ Внести аванс»
 * (регистратура, руководитель), «Вернуть аванс» (руководитель, с причиной) и история: кто внёс, какие приёмы оплачены
 * с аванса. Оплачивают приём «С аванса» в форме оплаты приёма — здесь только деньги вперёд и назад.
 */
export function AdvanceBox({ patientId, me }: { patientId: number; me: Me }) {
  const advance = useAdvance(patientId)
  const [form, setForm] = useState<'in' | 'refund' | null>(null)
  const [all, setAll] = useState(false)
  if (advance.isPending || advance.error) return null
  const a = advance.data
  const entries = a.entries ?? []
  const shown = all ? entries : entries.slice(0, 5)
  return (
    <section className="advance-box" aria-label="Аванс пациента">
      <h3>👛 {a.familyId != null ? 'Аванс семьи' : 'Аванс'}: <span className="num">{somText(a.balanceSom)}</span></h3>
      {a.familyId != null && (
        <p className="hint small">Общий счёт «{a.familyName}»{a.members?.length ? ` — ещё ${a.members.join(', ')}` : ''}: приёмы любого из них можно оплатить с него.</p>
      )}
      {a.balanceSom === 0 && entries.length === 0 && (
        <p className="hint small">Пациент платит вперёд — на брекеты, имплантацию? Внесите аванс: приёмы потом оплачиваются «С аванса».</p>
      )}
      {form == null && (takesAdvance(me) || (refundsAdvance(me) && a.balanceSom > 0)) && (
        <div className="actions">
          {takesAdvance(me) && <button type="button" className="btn" onClick={() => setForm('in')}>＋ Внести аванс</button>}
          {refundsAdvance(me) && a.balanceSom > 0 && <button type="button" className="link" onClick={() => setForm('refund')}>Вернуть аванс</button>}
        </div>
      )}
      {form && <AdvanceForm patientId={patientId} kind={form} balance={a.balanceSom} onDone={() => setForm(null)} />}
      {shown.length > 0 && (
        <ul className="cash-day-list advance-history" aria-label="История аванса">
          {shown.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="when num">{e.at ? shortDate(e.at) : ''}</span>
              <span className="what">{entryText(e)}{a.familyId != null && e.patient ? <span className="hint"> · {e.patient}</span> : null}
                {e.by ? <span className="hint"> · {e.by}</span> : null}</span>
              <span className={`sum num${e.deltaSom < 0 ? ' tone-bad' : ' tone-ok'}`}>{e.deltaSom > 0 ? '+' : '−'}{somText(Math.abs(e.deltaSom))}</span>
            </li>
          ))}
        </ul>
      )}
      {entries.length > shown.length && <button type="button" className="link" onClick={() => setAll(true)}>Вся история ({entries.length})</button>}
    </section>
  )
}

/** «Внести аванс» (сумма, способ, комментарий) или «Вернуть аванс» (сумма до остатка, способ, причина). */
function AdvanceForm({ patientId, kind, balance, onDone }: { patientId: number; kind: 'in' | 'refund'; balance: number; onDone: () => void }) {
  const client = useQueryClient()
  const refund = kind === 'refund'
  const [amount, setAmount] = useState(refund ? String(balance) : '')
  const [method, setMethod] = useState<Method>('CASH')
  const [text, setText] = useState('')
  const save = useMutation<Advance, ApiError>({
    mutationFn: () => {
      const path = { params: { path: { patientId } } }
      const amountSom = amount === '' ? undefined : Number(amount)
      return refund
        ? unwrap(api.POST('/api/patients/{patientId}/advance/refund', { ...path, body: { amountSom, method, reason: text.trim() } }))
        : unwrap(api.POST('/api/patients/{patientId}/advance', { ...path, body: { amountSom, method, comment: text.trim() || undefined } }))
    },
    onSuccess: (data) => {
      client.setQueryData(['advance', patientId], data)
      // Остаток семьи — у каждого её пациента; касса и касса дня видят внесение и возврат
      for (const k of ['advance', 'revenue', 'cash-entries', 'cash-day']) void client.invalidateQueries({ queryKey: [k] })
      onDone()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form className="form sub-form" aria-label={refund ? 'Вернуть аванс' : 'Внести аванс'} onSubmit={submit}>
      <label className="field"><span>{refund ? `Сколько вернуть, сом (на авансе ${somText(balance)})` : 'Сумма аванса, сом'}</span>
        <input inputMode="numeric" autoFocus value={amount} placeholder="20 000" onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <div className="segments" role="group" aria-label={refund ? 'Как вернули' : 'Как внесли'}>
        {METHODS.map(([m, t]) => <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}>{t}</button>)}
      </div>
      <label className="field"><span>{refund ? 'Причина возврата' : 'Комментарий (можно не писать)'}</span>
        <input value={text} maxLength={200} autoComplete="off" placeholder={refund ? 'Лечение отменили' : 'На брекеты'}
          onChange={(e) => setText(e.target.value)} /></label>
      {refund && <p className="hint small">Деньги уходят из клиники: возврат наличными — расход в «Кассе дня».</p>}
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending || !Number(amount) || (refund && !text.trim())}>
          {refund ? 'Вернуть' : 'Внести'}{amount ? ` ${somText(Number(amount))}` : ''}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}
