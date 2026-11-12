import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate, somText } from '../lib/time'

type Method = NonNullable<Schemas['OpeningDebtControllerPayRequest']['method']>

const METHODS: [Method, string][] = [['CASH', 'Наличными'], ['TRANSFER', 'Переводом'], ['CARD', 'Картой']]

/**
 * Долги из прежней программы (лист «Долги» шаблона переезда): к приёму не привязаны, поэтому — отдельным
 * блоком в «Касса → Должники» и в карточке пациента («Деньги»). «Погашен» — как отдали. Видит руководитель:
 * другим сервер ответит 403 — тогда блока нет, как и при пустом списке.
 */
export function OpeningDebtsBox({ patientId, onOpenPatient }: { patientId?: number; onOpenPatient?: (patientId: number) => void }) {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: ['opening-debts', patientId ?? 'all'],
    queryFn: () => unwrap(api.GET('/api/opening-debts', { params: { query: patientId ? { patientId } : {} } })),
    retry: false,
  })
  const [paying, setPaying] = useState<number | null>(null)
  const pay = useMutation<unknown, ApiError, { id: number; method: Method }>({
    mutationFn: ({ id, method }) => unwrap(api.POST('/api/opening-debts/{id}/paid', { params: { path: { id } }, body: { method } })),
    onSuccess: () => {
      setPaying(null)
      void client.invalidateQueries({ queryKey: ['opening-debts'] })
    },
  })
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
              {!patientId && (onOpenPatient
                ? <button type="button" className="row-link" onClick={() => onOpenPatient(d.patientId)}>{d.patient}</button>
                : <strong>{d.patient}</strong>)}
              {!patientId && ' · '}<b className="num">{somText(d.amountSom)}</b>
              <span className="hint small"> · перенесли {d.createdAt ? shortDate(d.createdAt) : ''}</span>
            </span>
            {paying === d.id ? (
              <span className="actions" role="group" aria-label="Как отдали">
                {METHODS.map(([m, text]) => (
                  <button key={m} type="button" className="btn small" disabled={pay.isPending} onClick={() => pay.mutate({ id: d.id, method: m })}>{text}</button>
                ))}
                <button type="button" className="btn small ghost" onClick={() => setPaying(null)}>Отмена</button>
              </span>
            ) : <button type="button" className="btn small" onClick={() => { pay.reset(); setPaying(d.id) }}>Погашен</button>}
          </li>
        ))}
      </ul>
      {pay.error && <p className="error" role="alert">{pay.error.message}</p>}
      <p className="hint small">Суммы из прежней программы — без приёма и врача. В выручку приёмов погашение не входит.</p>
    </section>
  )
}
