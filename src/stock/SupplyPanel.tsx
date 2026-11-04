import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useClose } from '../lib/useClose'
import { shortDate, somText } from '../lib/time'
import { isAssistant } from '../lib/roles'
import { Select } from '../layout/Select'

type Me = Schemas['BookingViewsMe']
type Supply = Schemas['SupplyView']

const REASONS: Record<string, string> = { USE: 'списали', DELIVERY: 'поставка', CORRECTION: 'пересчёт' }

/** Склад и его история — перечитать после любого изменения материала. */
function useRefresh() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['supplies'] })
    void client.invalidateQueries({ queryKey: ['supply-history'] })
  }
}

/** Цена за единицу в истории: «по 250 сом/шт». */
function unitPrice(costSom: number, delta: number, unit?: string): string {
  return delta > 0 ? ` (по ${somText(Math.round(costSom / delta))}/${unit ?? 'шт'})` : ''
}

/**
 * Карточка материала справа: списать или принять поставку (с ценой — она пойдёт в расходы),
 * поменять название, единицу и минимум, история движений. Удалить — только админ.
 */
export function SupplyPanel({ supply: s, me, onClose }: { supply: Supply; me: Me; onClose: () => void }) {
  useClose(onClose)
  const refresh = useRefresh()
  const [amount, setAmount] = useState('1')
  const [cost, setCost] = useState('')
  const [settings, setSettings] = useState({ name: s.name ?? '', unit: s.unit ?? '', minQuantity: String(s.minQuantity ?? 0) })
  const [done, setDone] = useState('')

  const history = useQuery({
    queryKey: ['supply-history', s.id],
    queryFn: () => unwrap(api.GET('/api/supplies/{id}/history', { params: { path: { id: s.id! } } })),
  })
  const move = useMutation<Supply, ApiError, number>({
    mutationFn: (delta) => unwrap(api.POST('/api/supplies/{id}/move', {
      params: { path: { id: s.id! } },
      body: { delta, reason: delta < 0 ? 'USE' : 'DELIVERY', costSom: delta > 0 && cost ? Number(cost) : undefined },
    })),
    onSuccess: (_updated, delta) => {
      setDone(delta < 0 ? `Списано ${-delta} ${s.unit}` : `Принято ${delta} ${s.unit}${cost ? ` · ${somText(Number(cost))}` : ''}`)
      setCost('')
      refresh()
    },
  })
  const save = useMutation<Supply, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/supplies/{id}', {
      params: { path: { id: s.id! } },
      body: { name: settings.name.trim(), unit: settings.unit.trim(), minQuantity: Number(settings.minQuantity) },
    })),
    onSuccess: () => {
      setDone('Сохранено')
      refresh()
    },
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/supplies/{id}', { params: { path: { id: s.id! } } })),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  const n = Math.trunc(Number(amount))
  const doMove = (sign: 1 | -1) => {
    setDone('')
    move.reset()
    if (!(n > 0)) return
    move.mutate(sign * n)
  }
  const submitSettings = (e: FormEvent) => {
    e.preventDefault()
    setDone('')
    save.mutate()
  }

  return (
    <aside className="panel" aria-label="Материал">
      <header className="panel-head">
        <div>
          <h2>{s.name}</h2>
          {s.doctorName && <span className="hint">Склад врача: {s.doctorName}</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <p className={`stock-big ${s.quantity === 0 ? 'tone-bad' : s.low ? 'tone-wait' : 'tone-ok'}`}>
        {s.quantity === 0 ? 'Закончился' : `Осталось: ${s.quantity} ${s.unit}${s.low ? ' — мало' : ''}`}
      </p>
      {s.orderedAt && <p className="hint">Заказан {shortDate(s.orderedAt)}{s.orderedBy ? ` · ${s.orderedBy}` : ''}</p>}

      <div className="form">
        <label className="field">
          <span>Сколько, {s.unit}</span>
          <input type="number" min={1} step={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {!(n > 0) && amount !== '' && <p className="error">Целое число больше 0</p>}
        {/* Ассистенту деньги не показываем: цену поставки вносит врач или админ */}
        {!isAssistant(me) && (
          <label className="field">
            <span>Сколько заплатили за поставку, сом — необязательно</span>
            <input type="number" min={0} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        )}
        <div className="actions">
          <button type="button" className="btn" disabled={move.isPending || !(n > 0)} onClick={() => doMove(-1)}>− Списать</button>
          <button type="button" className="btn primary" disabled={move.isPending || !(n > 0)} onClick={() => doMove(1)}>＋ Пришла поставка</button>
        </div>
        {move.error && <p className="error" role="alert">{move.error.fieldErrors.delta ?? move.error.fieldErrors.costSom ?? move.error.message}</p>}
        {done && <p className="tone-ok" role="status">{done}</p>}
      </div>

      <form className="form" aria-label="Настройки материала" onSubmit={submitSettings}>
        <h3>Настройки</h3>
        <label className="field"><span>Название</span>
          <input value={settings.name} required maxLength={100} onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
        </label>
        <div className="row">
          <label className="field"><span>Единица</span>
            <input value={settings.unit} required maxLength={20} onChange={(e) => setSettings({ ...settings, unit: e.target.value })} />
          </label>
          <label className="field"><span>Минимум</span>
            <input type="number" min={0} value={settings.minQuantity} onChange={(e) => setSettings({ ...settings, minQuantity: e.target.value })} />
          </label>
        </div>
        {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
        <button type="submit" className="btn" disabled={save.isPending}>Сохранить</button>
      </form>

      <section>
        <h3>История</h3>
        {history.data?.length ? (
          <ul className="visits">
            {history.data.map((m, i) => (
              <li key={i}>
                <b className={(m.delta ?? 0) < 0 ? 'tone-bad' : 'tone-ok'}>{(m.delta ?? 0) > 0 ? '+' : '−'}{Math.abs(m.delta ?? 0)}</b>
                {' '}{REASONS[m.reason ?? ''] ?? ''}{m.doctorName ? ` · ${m.doctorName}` : ''}
                {m.costSom != null && !isAssistant(me) && <span> · {somText(m.costSom)}<span className="hint">{unitPrice(m.costSom, m.delta ?? 0, s.unit)}</span></span>}
                {m.createdAt && <span className="hint"> · {shortDate(m.createdAt, true)}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="hint">{history.isPending ? 'Загрузка…' : 'Движений ещё не было'}</p>}
      </section>

      {me.admin && (
        <div className="danger-zone">
          <button type="button" className="btn danger" disabled={remove.isPending}
            onClick={() => void ask(`Удалить «${s.name}» со склада? История тоже пропадёт.`).then((ok) => ok && remove.mutate())}>Удалить материал</button>
          {remove.error && <p className="error">{remove.error.message}</p>}
        </div>
      )}
    </aside>
  )
}

/** Новый материал: название, единица, сколько есть, минимум; при «своём складе» — чей. */
export function NewSupplyPanel({ me, doctorId, onClose, onCreated }: {
  me: Me
  doctorId: number | null
  onClose: () => void
  onCreated: (s: Supply) => void
}) {
  useClose(onClose)
  const refresh = useRefresh()
  const separate = Boolean(me.clinic?.separateSupplies)
  const choosesDoctor = separate && (me.admin || me.reception || me.doctorId == null)
  const [form, setForm] = useState({ name: '', unit: 'шт', quantity: '', minQuantity: '1', costSom: '', doctorId: doctorId == null ? '' : String(doctorId) })
  const create = useMutation<Supply, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/supplies', {
      body: {
        name: form.name.trim(), unit: form.unit.trim(), quantity: Number(form.quantity || 0), minQuantity: Number(form.minQuantity || 0),
        costSom: form.costSom ? Number(form.costSom) : undefined,
        doctorId: choosesDoctor && form.doctorId ? Number(form.doctorId) : undefined,
      },
    })),
    onSuccess: (s) => {
      refresh()
      onCreated(s)
    },
  })
  const error = (field: string) => create.error?.fieldErrors[field]
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  return (
    <aside className="panel" aria-label="Новый материал">
      <header className="panel-head">
        <h2>Новый материал</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <label className="field"><span>Название</span>
          <input value={form.name} required maxLength={100} autoFocus placeholder="Например: Анестетик" onChange={set('name')} />
        </label>
        {error('name') && <p className="error">{error('name')}</p>}
        <div className="row">
          <label className="field"><span>Единица</span>
            <input value={form.unit} required maxLength={20} onChange={set('unit')} />
          </label>
          <label className="field"><span>Сколько есть</span>
            <input type="number" min={0} value={form.quantity} onChange={set('quantity')} />
          </label>
        </div>
        <div className="row">
          <label className="field"><span>Минимум</span>
            <input type="number" min={0} value={form.minQuantity} onChange={set('minQuantity')} />
          </label>
          {!isAssistant(me) && (
            <label className="field"><span>Заплатили, сом</span>
              <input type="number" min={0} value={form.costSom} placeholder="необязательно" onChange={set('costSom')} />
            </label>
          )}
        </div>
        {choosesDoctor && (
          <label className="field"><span>Чей склад</span>
            <Select value={form.doctorId} onChange={set('doctorId')}>
              <option value="">Общий</option>
              {(me.doctors ?? []).filter((d) => d.active !== false && (!isAssistant(me) || me.assistantOf!.includes(d.id!))).map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </Select>
          </label>
        )}
        {create.error && !Object.keys(create.error.fieldErrors).includes('name') && (
          <p className="error" role="alert">{Object.values(create.error.fieldErrors)[0] ?? create.error.message}</p>
        )}
        <button type="submit" className="btn primary" disabled={create.isPending}>Добавить</button>
      </form>
    </aside>
  )
}
