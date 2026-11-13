import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useClose } from '../lib/useClose'
import { Select } from '../layout/Select'
import { MoveFields } from './MoveFields'
import { useStockRefresh, useSupplyMove } from './supplyMove'

type Me = Schemas['BookingViewsMe']
type Supply = Schemas['SupplyView']

const NEW = 'new'

/**
 * Чей склад у поставки из «Расходов на склад»:
 * - `mine` — «Мои закупки» врача: только его склад;
 * - `clinic` — руководитель независимой клиники: только общий склад (личные склады — закупки врачей);
 * - `choose` — «свой склад у каждого врача» и видит всех: выбор «Общий» или врач;
 * - `all` — один склад на всех.
 */
export type StockScope = 'mine' | 'clinic' | 'choose' | 'all'

/**
 * «＋ Поставка» прямо в «Расходах на склад»: материал (поиск по складу; нет — «＋ Новый материал»),
 * сколько, сумма, дата поставки. Отправляет тот же запрос, что «＋ Пришла поставка» в карточке
 * материала (useSupplyMove); новый материал сначала заводится с остатком 0 — приход идёт поставкой,
 * чтобы у неё были дата и сумма.
 */
export function DeliverySheet({ me, supplies, scope, onClose }: {
  me: Me
  supplies: Supply[]
  scope: StockScope
  onClose: () => void
}) {
  useClose(onClose)
  const refresh = useStockRefresh()
  const m = useSupplyMove({ named: true })
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // Чей склад: '' — общий, иначе id врача (только при выборе)
  const [owner, setOwner] = useState('')
  const ownerId = scope === 'mine' ? me.doctorId ?? null : scope === 'choose' && owner ? Number(owner) : null
  const list = supplies
    .filter((s) => scope === 'all' || (s.doctorId ?? null) === ownerId)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ru'))
  const [picked, setPicked] = useState('')
  const [fresh, setFresh] = useState({ name: '', unit: 'шт' })
  const [created, setCreated] = useState<Supply | null>(null)
  const supply = created && String(created.id) === picked ? created : list.find((s) => String(s.id) === picked) ?? null

  const create = useMutation<Supply, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/supplies', {
      body: {
        name: fresh.name.trim(), unit: fresh.unit.trim(), quantity: 0, minQuantity: 1,
        // Склад врача — только при выборе; врачу сервер сам ставит его склад
        doctorId: scope === 'choose' && ownerId != null ? ownerId : undefined,
      },
    })),
    onSuccess: (s) => {
      setCreated(s)
      setPicked(String(s.id))
      setFresh({ name: '', unit: 'шт' })
      refresh()
      m.submit(s, 1)
    },
  })

  const submit = () => {
    m.setDone('')
    if (!(m.n > 0)) return
    if (picked === NEW) {
      create.reset()
      create.mutate()
    } else if (supply) {
      m.submit(supply, 1)
    }
  }
  const busy = create.isPending || m.move.isPending
  const ready = m.n > 0 && (picked === NEW ? fresh.name.trim() !== '' : supply != null)

  return (
    <aside className="panel" aria-label="Новая поставка">
      <header className="panel-head">
        <h2>Поставка</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {scope === 'choose' && (
          <label className="field"><span>Чей склад</span>
            <Select value={owner} onChange={(e) => { setOwner(e.target.value); setPicked('') }}>
              <option value="">Общий</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </Select>
          </label>
        )}
        <label className="field"><span>Материал</span>
          <Select value={picked} onChange={(e) => { setPicked(e.target.value); m.setDone(''); m.move.reset() }}>
            <option value="" disabled>Выберите материал</option>
            {list.map((s) => <option key={s.id} value={s.id}>{`${s.name} · осталось ${s.quantity} ${s.unit}`}</option>)}
            <option value={NEW}>＋ Новый материал</option>
          </Select>
        </label>
        {picked === NEW && (
          <div className="row">
            <label className="field"><span>Название</span>
              <input value={fresh.name} required maxLength={100} autoFocus placeholder="Например: Анестетик"
                onChange={(e) => setFresh({ ...fresh, name: e.target.value })} />
            </label>
            <label className="field"><span>Единица</span>
              <input value={fresh.unit} required maxLength={20} onChange={(e) => setFresh({ ...fresh, unit: e.target.value })} />
            </label>
          </div>
        )}
        {create.error && <p className="error" role="alert">{create.error.fieldErrors.name ?? Object.values(create.error.fieldErrors)[0] ?? create.error.message}</p>}
        <MoveFields m={m} me={me} unit={picked === NEW ? fresh.unit : supply?.unit} />
        <button type="submit" className="btn primary" disabled={busy || !ready}>Добавить поставку</button>
        {m.error && <p className="error" role="alert">{m.error}</p>}
        {m.done && <p className="tone-ok" role="status">{m.done}</p>}
      </form>
    </aside>
  )
}
