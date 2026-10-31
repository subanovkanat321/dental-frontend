import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { NewSupplyPanel, SupplyPanel } from './SupplyPanel'

type Me = Schemas['BookingViewsMe']
type Supply = Schemas['SupplyView']

type Side = { kind: 'supply'; id: number } | { kind: 'new' } | null

/**
 * «Склад»: материалы таблицей — что заканчивается, сверху и красным; карточка справа: списать,
 * принять поставку, настроить минимум, история. «Свой склад у каждого врача» (V61): врач видит
 * свой и общий, админ и регистратура — весь или выбранного врача. Права проверяет сервер.
 */
export function StockPage({ me }: { me: Me }) {
  const client = useQueryClient()
  const separate = Boolean(me.clinic?.separateSupplies)
  const choosesDoctor = separate && (me.admin || me.reception || me.doctorId == null)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [side, setSide] = useState<Side>(null)

  const supplies = useQuery({
    queryKey: ['supplies', doctorId],
    queryFn: () => unwrap(api.GET('/api/supplies', { params: { query: doctorId == null ? {} : { doctorId } } })),
  })
  const samples = useMutation({
    mutationFn: () => unwrap(api.POST('/api/supplies/samples')),
    onSuccess: () => client.invalidateQueries({ queryKey: ['supplies'] }),
  })

  const all = supplies.data ?? []
  const text = query.trim().toLowerCase()
  const shown = all
    .filter((s) => (!lowOnly || s.low) && (!text || s.name?.toLowerCase().includes(text)))
    // Заканчивается — сверху: это то, что надо заказать сегодня
    .sort((a, b) => Number(b.low) - Number(a.low) || (a.name ?? '').localeCompare(b.name ?? '', 'ru'))
  const low = all.filter((s) => s.low).length
  const selected = side?.kind === 'supply' ? all.find((s) => s.id === side.id) ?? null : null

  return (
    <div className={side ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        <header className="toolbar">
          <h1>Склад</h1>
          <input type="search" className="search" aria-label="Поиск материала" placeholder="Название" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {choosesDoctor && doctors.length > 0 && (
            <select aria-label="Чей склад" value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Весь склад</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          )}
          <label className="check">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Только заканчивается{low ? ` (${low})` : ''}
          </label>
          <button type="button" className="btn primary push" onClick={() => setSide({ kind: 'new' })}>＋ Материал</button>
        </header>

        {supplies.isPending && <p className="hint">Загрузка…</p>}
        {supplies.error && <p className="error">{supplies.error.message}</p>}
        {supplies.isSuccess && all.length === 0 && (
          <div className="empty">
            <p>Склад пуст. Добавьте материалы по одному или начните с типового набора — потом поправите количество.</p>
            <button type="button" className="btn" disabled={samples.isPending} onClick={() => samples.mutate()}>Добавить типовой набор</button>
            {samples.error && <p className="error">{samples.error.message}</p>}
          </div>
        )}
        {all.length > 0 && shown.length === 0 && <p className="hint">Ничего не нашли.</p>}
        {shown.length > 0 && (
          <table className="table" aria-label="Материалы">
            <thead>
              <tr>
                <th>Материал</th>
                <th>Осталось</th>
                <th>Минимум</th>
                {separate && <th>Чей</th>}
                <th>Заказ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s: Supply) => (
                <tr key={s.id} className={selected?.id === s.id ? 'active' : undefined}>
                  <td><button type="button" className="row-link" onClick={() => setSide({ kind: 'supply', id: s.id! })}>{s.name}</button></td>
                  <td className={`nowrap strong ${s.quantity === 0 ? 'tone-bad' : s.low ? 'tone-wait' : ''}`}>
                    {s.quantity === 0 ? '❌ закончился' : `${s.low ? '⚠️ ' : ''}${s.quantity} ${s.unit}`}
                  </td>
                  <td className="hint nowrap">{s.minQuantity} {s.unit}</td>
                  {separate && <td className="hint">{s.doctorName ?? 'общий'}</td>}
                  <td className="hint">{s.orderedAt ? `✅ заказан ${shortDate(s.orderedAt)}${s.orderedBy ? ` · ${s.orderedBy}` : ''}` : s.low ? 'нужно заказать' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {selected && <SupplyPanel key={selected.id} supply={selected} me={me} onClose={() => setSide(null)} />}
      {side?.kind === 'new' && (
        <NewSupplyPanel me={me} doctorId={doctorId} onClose={() => setSide(null)} onCreated={(s) => setSide({ kind: 'supply', id: s.id! })} />
      )}
    </div>
  )
}
