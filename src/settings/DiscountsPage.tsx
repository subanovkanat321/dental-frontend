import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { SubHelp } from '../layout/PageHead'
import { useDiscountPolicy } from '../schedule/discountDraft'
import { SubHeader } from './SubHeader'

type Me = Schemas['BookingViewsMe']
type Who = NonNullable<Schemas['DiscountPoliciesPolicy']['who']>

const WHO: [Who, string, string][] = [
  ['ADMIN', 'Только руководитель', 'Скидку в оплате даёт только руководитель'],
  ['RECEPTION', 'Руководитель и регистратура', 'Регистратура — до предела ниже'],
  ['ALL', 'Ещё и врачи', 'Регистратура и врачи — до предела ниже'],
]

/**
 * «Настройки → Пациенты и скидки → Скидки» (V241 бэкенда): кто, кроме руководителя, может дать скидку в оплате и до скольких процентов от
 * цены. Руководитель даёт любую. Меняет руководитель (сервер: 403 остальным).
 */
const NBSP = '\u00a0'

export function DiscountsPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const policy = useDiscountPolicy()
  const client = useQueryClient()
  const [who, setWho] = useState<Who | null>(null)
  const [max, setMax] = useState<string | null>(null)
  const save = useMutation<Schemas['DiscountPoliciesPolicy'], ApiError, void>({
    mutationFn: () => unwrap(api.PUT('/api/clinic/discounts', {
      body: { who: who ?? policy.data?.who ?? 'ADMIN', maxPercent: Number(max ?? policy.data?.maxPercent ?? 10) },
    })),
    onSuccess: (p) => {
      client.setQueryData(['discount-policy'], p)
      setWho(null)
      setMax(null)
    },
  })
  const admin = Boolean(me.admin)
  const current = who ?? policy.data?.who ?? 'ADMIN'
  const maxValue = max ?? String(policy.data?.maxPercent ?? 10)
  return (
    <section className="schedule-main settings discounts-page">
      <SubHeader title="Скидки" onBack={onBack}>
        <SubHelp title="Скидки">Скидку дают в форме оплаты приёма: «＋ Скидка» — процентом или суммой и причина. Итог считает Tish,
          скидка видна в квитанции, отчётах и журнале действий. Выручка и процент врача — от суммы со скидкой.</SubHelp>
      </SubHeader>
      {policy.isPending ? <Loading /> : policy.error ? <p className="error" role="alert">{policy.error.message}</p> : (
        <form className="card-block discount-form" aria-label="Кто может давать скидку"
          onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <h2>Кто может давать скидку</h2>
          <div className="radio-list" role="radiogroup" aria-label="Кто может давать скидку">
            {WHO.map(([code, title, hint]) => (
              <label key={code} className="radio-row">
                <input type="radio" name="who" checked={current === code} disabled={!admin} onChange={() => setWho(code)} />
                <span><b>{title}</b><span className="hint small"> — {hint}</span></span>
              </label>
            ))}
          </div>
          {current !== 'ADMIN' && (
            <label className="field narrow"><span>Предел скидки, % от цены</span>
              <input type="number" min={1} max={100} inputMode="numeric" disabled={!admin} value={maxValue}
                onChange={(e) => setMax(e.target.value)} /></label>
          )}
          <p className="hint small">Руководитель может дать любую скидку. Сумма в сомах проверяется той же меркой: 600 из 5{NBSP}000 — 12{NBSP}%.</p>
          {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
          {save.isSuccess && who == null && max == null && <p className="tone-ok" role="status">✓ Сохранено</p>}
          {admin ? <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
            : <p className="hint">Настройку меняет руководитель клиники.</p>}
        </form>
      )}
    </section>
  )
}
