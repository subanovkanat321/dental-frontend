import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate, somText } from '../lib/time'
import { CalmRow, RowMenu } from '../patients/CalmList'
import { useOpeningDebts } from './useOpeningDebts'

type Method = NonNullable<Schemas['OpeningDebtControllerPayRequest']['method']>
type OpeningDebt = Schemas['OpeningDebtsView']

const METHODS: [Method, string][] = [['CASH', 'Наличными'], ['TRANSFER', 'Переводом'], ['CARD', 'Картой']]

/** «Погашен» — как отдали: наличными, переводом, картой. Сервер записывает оплату в кассу. */
function usePayOpening(onDone: () => void) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, { id: number; method: Method }>({
    mutationFn: ({ id, method }) => unwrap(api.POST('/api/opening-debts/{id}/paid', { params: { path: { id } }, body: { method } })),
    onSuccess: () => {
      onDone()
      void client.invalidateQueries({ queryKey: ['opening-debts'] })
    },
  })
}

function HowPaid({ busy, onPick, onCancel }: { busy: boolean; onPick: (m: Method) => void; onCancel: () => void }) {
  return (
    <span className="actions" role="group" aria-label="Как отдали">
      {METHODS.map(([m, text]) => <button key={m} type="button" className="btn small" disabled={busy} onClick={() => onPick(m)}>{text}</button>)}
      <button type="button" className="btn small ghost" onClick={onCancel}>Отмена</button>
    </span>
  )
}

/**
 * «Касса → Должники», блок «Старые долги»: те же спокойные строки, что у должников по приёмам. Главное
 * действие — «Принять оплату» (под строкой — как отдали), в «⋯» — карточка пациента.
 */
export function OpeningDebtsList({ rows, onOpenPatient }: { rows: OpeningDebt[]; onOpenPatient?: (patientId: number) => void }) {
  const [paying, setPaying] = useState<number | null>(null)
  const pay = usePayOpening(() => setPaying(null))
  return (
    <ul className="calm-list" aria-label="Старые долги">
      {rows.map((d) => {
        const open = onOpenPatient ? () => onOpenPatient(d.patientId) : null
        return (
          <CalmRow key={d.id} open={open} name={d.patient ?? '—'}
            sub={d.createdAt ? `перенесли ${shortDate(d.createdAt)}` : 'без даты'}
            meta={<span className="debt-sum num">{somText(d.amountSom)}</span>}
            action={paying !== d.id && <button type="button" className="btn" onClick={() => { pay.reset(); setPaying(d.id) }}>Принять оплату</button>}
            menu={open && <RowMenu label={`Ещё: ${d.patient ?? ''}`} items={[{ label: 'Открыть пациента', onSelect: open }]} />}>
            {paying === d.id && <>
              <HowPaid busy={pay.isPending} onPick={(method) => pay.mutate({ id: d.id, method })} onCancel={() => setPaying(null)} />
              {pay.error && <p className="error" role="alert">{pay.error.message}</p>}
            </>}
          </CalmRow>
        )
      })}
    </ul>
  )
}

/**
 * Карточка пациента («Деньги»): его долги из прежней программы — сумма, когда перенесли, «Погашен» → как отдали.
 * Нет долгов или нет прав — блока нет.
 */
export function OpeningDebtsBox({ patientId }: { patientId: number }) {
  const list = useOpeningDebts(patientId)
  const [paying, setPaying] = useState<number | null>(null)
  const pay = usePayOpening(() => setPaying(null))
  const rows = list.data ?? []
  if (!rows.length) return null
  const total = rows.reduce((s, d) => s + d.amountSom, 0)
  return (
    <section className="opening-debts" aria-label="Долги из прежней программы">
      <h3>Долги из прежней программы{rows.length > 1 ? ` · ${somText(total)}` : ''}</h3>
      <ul>
        {rows.map((d) => (
          <li key={d.id}>
            <span>
              <b className="num">{somText(d.amountSom)}</b>
              <span className="hint small"> · перенесли {d.createdAt ? shortDate(d.createdAt) : ''}</span>
            </span>
            {paying === d.id
              ? <HowPaid busy={pay.isPending} onPick={(method) => pay.mutate({ id: d.id, method })} onCancel={() => setPaying(null)} />
              : <button type="button" className="btn small" onClick={() => { pay.reset(); setPaying(d.id) }}>Погашен</button>}
          </li>
        ))}
      </ul>
      {pay.error && <p className="error" role="alert">{pay.error.message}</p>}
      <p className="hint small">Суммы из прежней программы — без приёма и врача. В выручку приёмов погашение не входит.</p>
    </section>
  )
}
