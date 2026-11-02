import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

type Item = Schemas['ServiceSuppliesItem']
type Row = { supplyId: number; name: string; unit: string; quantity: string; owner?: string | null }

function rowOf(i: Item): Row {
  return { supplyId: i.supplyId!, name: i.name ?? '', unit: i.unit ?? '', quantity: String(i.quantity ?? 1), owner: i.doctorName }
}

/**
 * «Материалы по умолчанию» услуги: что обычно уходит на приёме. На приёме с этой услугой врач
 * увидит список готовым и спишет его сам одной кнопкой — молча ничего не списывается.
 */
export function ServiceSupplies({ serviceId }: { serviceId: number }) {
  const client = useQueryClient()
  const saved = useQuery({
    queryKey: ['service-supplies', serviceId],
    queryFn: () => unwrap(api.GET('/api/service-types/{id}/supplies', { params: { path: { id: serviceId } } })),
  })
  const stock = useQuery({ queryKey: ['supplies', null], queryFn: () => unwrap(api.GET('/api/supplies')) })
  const [draft, setDraft] = useState<Row[] | null>(null)
  const [pick, setPick] = useState<number | ''>('')
  const [done, setDone] = useState('')
  const rows = draft ?? (saved.data ?? []).map(rowOf)
  const change = (next: Row[]) => {
    setDone('')
    setDraft(next)
  }
  const save = useMutation<Item[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/service-types/{id}/supplies', {
      params: { path: { id: serviceId } },
      body: { items: rows.map((r) => ({ supplyId: r.supplyId, quantity: Number(r.quantity) })) },
    })),
    onSuccess: (items) => {
      client.setQueryData(['service-supplies', serviceId], items)
      setDraft(null)
      setDone('Сохранено')
    },
  })
  const add = () => {
    const s = stock.data?.find((x) => x.id === pick)
    if (!s) return
    change([...rows, { supplyId: s.id!, name: s.name ?? '', unit: s.unit ?? '', quantity: '1', owner: s.doctorName }])
    setPick('')
  }
  const free = (stock.data ?? []).filter((x) => !rows.some((r) => r.supplyId === x.id))
  const invalid = rows.some((r) => !/^\d+$/.test(r.quantity) || Number(r.quantity) < 1 || Number(r.quantity) > 1000)

  return (
    <section className="form service-supplies" aria-label="Материалы по умолчанию">
      <h3>Материалы по умолчанию</h3>
      <p className="hint">Что обычно уходит на приёме. Врач увидит этот список в карточке приёма и спишет его со склада одной кнопкой — сам, после проверки.</p>
      {saved.error && <p className="error">{saved.error.message}</p>}
      {saved.isPending ? <p className="hint">Загрузка…</p> : rows.length > 0 ? (
        <ul className="supply-rows">
          {rows.map((r, i) => (
            <li key={r.supplyId}>
              <span>{r.name}{r.owner && <span className="hint"> · {r.owner}</span>}</span>
              <span className="actions">
                <input type="number" min={1} max={1000} inputMode="numeric" aria-label={`Сколько: ${r.name}`} value={r.quantity}
                  onChange={(e) => change(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <span className="hint">{r.unit}</span>
                <button type="button" className="btn small ghost" aria-label={`Убрать: ${r.name}`}
                  onClick={() => change(rows.filter((_, j) => j !== i))}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="hint">Пока ничего — добавьте со склада.</p>}
      {stock.data && (free.length ? (
        <div className="row add-supply">
          <select aria-label="Добавить материал" value={pick} onChange={(e) => setPick(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Материал со склада…</option>
            {free.map((x) => <option key={x.id} value={x.id}>{x.name}{x.doctorName ? ` · ${x.doctorName}` : ''} ({x.unit})</option>)}
          </select>
          <button type="button" className="btn" disabled={pick === ''} onClick={add}>Добавить</button>
        </div>
      ) : !stock.data.length && <p className="hint small">На складе пока нет материалов — добавьте их в «Склад».</p>)}
      {invalid && <p className="error">Сколько — целое число от 1 до 1000</p>}
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      {draft && <button type="button" className="btn primary" disabled={save.isPending || invalid} onClick={() => save.mutate()}>Сохранить материалы</button>}
    </section>
  )
}
