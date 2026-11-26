import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { somText } from '../lib/time'
import { discountAmount, QUICK_PERCENTS } from './stepDiscount'

type Step = Schemas['TreatmentStepView']
type Policy = Schemas['DiscountPoliciesPolicy']

/**
 * «🏷 Скидка на выбранные» и «🏷 Скидка на весь план, %» (V257 бэкенда): одна скидка процентом — каждому этапу (этапы без
 * цены пропускает сервер). Предел — «Настройки → Пациенты и скидки → Скидки»: кнопки больше предела не показываем, сервер проверит всё равно.
 * «Снять скидку» — у всех этих этапов. Сохраняет сервер (PUT /plan/discount), ответ — этапы варианта.
 */
export function PlanDiscountForm({ patientId, steps, label, policy, onDone }: {
  patientId: number
  steps: Step[]
  label: string
  policy?: Policy
  onDone: (steps?: Step[]) => void
}) {
  const priced = steps.filter((s) => (s.priceSom ?? 0) > 0)
  const max = policy?.myMaxPercent ?? 100
  const [percent, setPercent] = useState('')
  const value = Number(percent)
  const save = useMutation<Step[], ApiError, number | null>({
    mutationFn: (p) => unwrap(api.PUT('/api/patients/{patientId}/plan/discount', {
      params: { path: { patientId } },
      body: { stepIds: (p ? priced : steps).map((s) => s.id), discount: p ? { percent: p } : undefined },
    })),
    onSuccess: (fresh) => onDone(fresh),
  })
  const full = priced.reduce((sum, s) => sum + (s.priceSom ?? 0), 0)
  const off = value > 0 ? priced.reduce((sum, s) => sum + discountAmount(s.priceSom ?? 0, { kind: 'percent', value }), 0) : 0
  const tooMuch = value > max
  const had = steps.some((s) => s.discountSom)
  return (
    <form className="plan-discount-form" aria-label={label} onSubmit={(e) => { e.preventDefault(); if (value > 0 && !tooMuch) save.mutate(value) }}>
      <p className="plan-discount-head"><b>{label}</b> <span className="hint small">· {priced.length} {priced.length === 1 ? 'этап' : priced.length < 5 ? 'этапа' : 'этапов'} с ценой</span></p>
      <div className="chips-pick" role="group" aria-label="Скидка в процентах">
        {QUICK_PERCENTS.filter((p) => p <= max).map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={percent === String(p)} onClick={() => setPercent(String(p))}>{p} %</button>
        ))}
        <input type="number" min={1} max={100} inputMode="numeric" className="step-discount-value" aria-label="Скидка на этапы, %" placeholder="%"
          value={QUICK_PERCENTS.includes(value) ? '' : percent} onChange={(e) => setPercent(e.target.value)} />
      </div>
      {off > 0 && !tooMuch && (
        <p className="hint small num" role="status">{somText(full)} → <b>{somText(full - off)}</b>, скидка {somText(off)}</p>
      )}
      {tooMuch && <p className="error small" role="alert">Ваш предел скидки — до {max} % от цены: больше решает руководитель</p>}
      {save.error && <p className="error small" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending || !(value > 0) || tooMuch || priced.length === 0}>Применить</button>
        {had && <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>Снять скидку</button>}
        <button type="button" className="btn ghost" onClick={() => onDone()}>Отмена</button>
      </div>
    </form>
  )
}
