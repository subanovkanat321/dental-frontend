import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'
import { clinicRequest } from '../settings/clinicUpdate'
import { SpendingBlock } from './Spending'
import { NewSupplyPanel, SupplyPanel } from './SupplyPanel'
import { stickyHead } from '../layout/stickyHead'
import { EmptyState } from '../layout/EmptyState'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { HelpHint } from '../help/HelpHint'

type Me = Schemas['BookingViewsMe']
type Supply = Schemas['SupplyView']

type Side = { kind: 'supply'; id: number } | { kind: 'new' } | null

/**
 * «Склад»: материалы таблицей — что заканчивается, сверху и красным; карточка справа: списать,
 * принять поставку, настроить минимум, история. «Свой склад у каждого врача» (V61): врач видит
 * свой и общий, админ и регистратура — весь или выбранного врача. Права проверяет сервер.
 */
/** initialSupply — кнопка бота «Открыть склад» в сигнале «заканчивается»: сразу этот материал. */
export function StockPage({ me, initialSupply }: { me: Me; initialSupply?: number }) {
  const client = useQueryClient()
  const separate = Boolean(me.clinic?.separateSupplies)
  const choosesDoctor = separate && (me.admin || me.reception || me.doctorId == null)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // Чей склад: весь, только общий или врача
  const [owner, setOwner] = useState<'' | 'shared' | number>('')
  const doctorId = typeof owner === 'number' ? owner : null
  const [spending, setSpending] = useState(false)
  const [query, setQuery] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [side, setSide] = useState<Side>(initialSupply ? { kind: 'supply', id: initialSupply } : null)
  const close = useCallback(() => setSide(null), [setSide])

  const supplies = useQuery({
    queryKey: ['supplies', doctorId],
    queryFn: () => unwrap(api.GET('/api/supplies', { params: { query: doctorId == null ? {} : { doctorId } } })),
  })
  // Быстрое «−1» прямо в списке: взяли одну карпулу — не открывая карточку
  // Списали не то — «Вернуть» несколько секунд (пересчёт +1, как «вернуть» на приёме)
  const [taken, setTaken] = useState<Supply | null>(null)
  const take = useMutation<Supply, ApiError, Supply>({
    mutationFn: (s) => unwrap(api.POST('/api/supplies/{id}/move', { params: { path: { id: s.id! } }, body: { delta: -1 } })),
    onSuccess: (_, s) => {
      setTaken(s)
      void client.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
  const giveBack = useMutation<Supply, ApiError, Supply>({
    mutationFn: (s) => unwrap(api.POST('/api/supplies/{id}/move', { params: { path: { id: s.id! } }, body: { delta: 1, reason: 'CORRECTION' } })),
    onSuccess: () => {
      setTaken(null)
      void client.invalidateQueries({ queryKey: ['supplies'] })
      void client.invalidateQueries({ queryKey: ['supply-history'] })
    },
  })
  useEffect(() => {
    if (!taken) return
    const t = setTimeout(() => setTaken(null), 8000)
    return () => clearTimeout(t)
  }, [taken])
  const samples = useMutation({
    mutationFn: () => unwrap(api.POST('/api/supplies/samples')),
    onSuccess: () => client.invalidateQueries({ queryKey: ['supplies'] }),
  })

  const all = supplies.data ?? []
  const text = query.trim().toLowerCase()
  const shown = all
    .filter((s) => (!lowOnly || s.low) && (!text || s.name?.toLowerCase().includes(text)) && (owner !== 'shared' || s.doctorId == null))
    // Заканчивается — сверху: это то, что надо заказать сегодня
    .sort((a, b) => Number(b.low) - Number(a.low) || (a.name ?? '').localeCompare(b.name ?? '', 'ru'))
  const low = all.filter((s) => s.low).length
  const selected = side?.kind === 'supply' ? all.find((s) => s.id === side.id) ?? null : null

  return (
    <div className={side ? 'schedule with-panel' : 'schedule'}>
      <section className="schedule-main">
        <header ref={stickyHead} className="toolbar sticky-head">
          <div className="with-hint"><h1>Склад</h1><HelpHint hint="stock" /></div>
          <input type="search" className="search" aria-label="Поиск материала" placeholder="Название" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {choosesDoctor && doctors.length > 0 && (
            <Select aria-label="Чей склад" value={owner} onChange={(e) => {
              const v = e.target.value
              setOwner(v === '' || v === 'shared' ? v : Number(v))
            }}>
              <option value="">Весь склад</option>
              <option value="shared">Общий</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </Select>
          )}
          <label className="check">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Только заканчивается{low ? ` (${low})` : ''}
          </label>
          {me.admin && <button type="button" className="btn push" aria-pressed={spending} onClick={() => setSpending(!spending)}>Расходы на склад</button>}
          <button type="button" className={me.admin ? 'btn primary' : 'btn primary push'} onClick={() => setSide({ kind: 'new' })}
            title="Новая позиция на складе: материал или инструмент, которого ещё нет в списке">＋ Новый материал</button>
        </header>
        {/* «＋ Новый материал» — новая позиция; пришла поставка уже имеющегося — через сам материал */}
        {all.length > 0 && <p className="hint small stock-how">Пришла поставка — нажмите на материал в списке → «＋ Пришла поставка». «＋ Новый материал» — только если его ещё нет в списке.</p>}
        {me.admin && <SeparateSupplies />}
        {spending && <SpendingBlock />}

        {supplies.isPending && <Loading />}
        {supplies.error && <p className="error">{supplies.error.message}</p>}
        {supplies.isSuccess && all.length === 0 && (
          <EmptyState title="Склад пуст" action={(
            <button type="button" className="btn" disabled={samples.isPending} onClick={() => samples.mutate()}>Добавить типовой набор</button>
          )}>
            Добавьте материалы по одному или начните с типового набора — потом поправите количество.
            {samples.error && <span className="error"> {samples.error.message}</span>}
          </EmptyState>
        )}
        {supplies.isSuccess && all.length > 0 && all.length < 10 && (
          <p className="hint">Материалов пока мало — <button type="button" className="link" disabled={samples.isPending} onClick={() => samples.mutate()}>добавить типовой набор</button> (повторы не появятся).</p>
        )}
        {all.length > 0 && shown.length === 0 && <EmptyState compact title="Ничего не нашли" />}
        {samples.data && <p className="tone-ok" role="status">{samples.data.added ? `Добавлено материалов: ${samples.data.added}` : 'Типовой набор уже на складе'}</p>}
        {take.error && <p className="error" role="alert">{take.error.fieldErrors.delta ?? take.error.message}</p>}
        {taken && (
          <div className="undo" role="status">
            <span>Списано 1 {taken.unit}: {taken.name}</span>
            <button type="button" className="btn small" disabled={giveBack.isPending} onClick={() => giveBack.mutate(taken)}>Вернуть</button>
          </div>
        )}
        {giveBack.error && <p className="error" role="alert">{giveBack.error.message}</p>}
        {shown.length > 0 && (
          <table className="table" aria-label="Материалы">
            <thead>
              <tr>
                <th>Материал</th>
                <th>Осталось</th>
                <th>Минимум</th>
                {separate && <th>Чей</th>}
                <th>Заказ</th>
                <th><span className="sr-only">Списать</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s: Supply) => (
                <tr key={s.id} className={selected?.id === s.id ? 'active' : undefined}>
                  <td><button type="button" className="row-link" onClick={() => setSide({ kind: 'supply', id: s.id! })}>{s.name}</button></td>
                  <td className={`nowrap strong ${s.quantity === 0 ? 'tone-bad' : s.low ? 'tone-wait' : ''}`}>
                    {s.quantity === 0 ? 'закончился' : `${s.quantity} ${s.unit}${s.low ? ' · мало' : ''}`}
                  </td>
                  <td className="hint nowrap">{s.minQuantity} {s.unit}</td>
                  {separate && <td className="hint">{s.doctorName ?? 'общий'}</td>}
                  <td className="hint">{s.orderedAt ? `заказан ${shortDate(s.orderedAt)}${s.orderedBy ? ` · ${s.orderedBy}` : ''}` : s.low ? 'нужно заказать' : ''}</td>
                  <td className="r">
                    {(s.quantity ?? 0) > 0 && (
                      <button type="button" className="btn small" aria-label={`Списать 1: ${s.name}`} disabled={take.isPending}
                        onClick={() => take.mutate(s)}>−1</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {selected && <SupplyPanel key={selected.id} supply={selected} me={me} onClose={close} />}
      {side?.kind === 'new' && (
        <NewSupplyPanel me={me} doctorId={doctorId} onClose={close} onCreated={(s) => setSide({ kind: 'supply', id: s.id! })} />
      )}
    </div>
  )
}

/**
 * Админу — прямо на складе: один склад на всех или свой у каждого врача (врач видит и тратит свои
 * и общие). Сохраняется сразу; тот же флажок — в «О клинике».
 */
function SeparateSupplies() {
  const client = useQueryClient()
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  const save = useMutation<Schemas['ClinicView'], ApiError, boolean>({
    mutationFn: (on) => unwrap(api.PUT('/api/clinic', { body: clinicRequest(clinic.data!, { separateSupplies: on }) })),
    onSuccess: (saved) => {
      client.setQueryData(['clinic'], saved)
      void client.invalidateQueries({ queryKey: ['me'] })
      void client.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
  if (!clinic.data) return null
  return (
    <div className="stock-mode">
      <label className="check">
        <input type="checkbox" checked={Boolean(clinic.data.separateSupplies)} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
        Свой склад у каждого врача
      </label>
      <span className="hint">{clinic.data.separateSupplies ? 'Врач видит и тратит свои материалы и общие.' : 'Сейчас один склад на всех.'}</span>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
}
