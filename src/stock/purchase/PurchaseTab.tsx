import { useState } from 'react'

import type { Schemas } from '../../api/client'
import { ask } from '../../lib/confirm'
import { isAssistant } from '../../lib/roles'
import { openLink } from '../../lib/telegram'
import { whatsappUrl } from '../../lib/texts'
import { formatPhone, somText } from '../../lib/time'
import { EmptyState } from '../../layout/EmptyState'
import { Fold } from '../../layout/Fold'
import { HeadTools } from '../../layout/PageHead'
import { Loading } from '../../layout/Loading'
import { Select } from '../../layout/Select'
import { CalmRow, RowMenu, type MenuItem } from '../../patients/CalmList'
import { ReceiveSheet } from './ReceiveSheet'
import { SuppliersDialog } from './SuppliersDialog'
import {
  dayText, itemsText, useCancelOrder, usePurchases, useSendOrder, useSuppliers, useSupplyOrder,
  type DraftGroup, type DraftItem, type Order,
} from './api'
import '../../lab/lab.css'
import './purchase.css'

type Me = Schemas['BookingViewsMe']

/**
 * «Склад → Заказ»: список к закупке собирается сам — что ниже порога и что добавили вручную, количество — до запаса
 * на месяц по расходу за 30 дней (можно поправить). Спокойным списком по поставщикам: у каждого — «Отправить в
 * WhatsApp» с готовым текстом (своим нажатием, массовой отправки нет). Отправленные — «Ждём», с «Пришло».
 * Цены и суммы — не ассистенту (сервер их и не пришлёт).
 */
export function PurchaseTab({ me, supplies }: { me: Me; supplies: Schemas['SupplyView'][] }) {
  const list = usePurchases()
  const suppliers = useSuppliers()
  const [directory, setDirectory] = useState(false)
  const [receiving, setReceiving] = useState<Order | null>(null)
  const [adding, setAdding] = useState(false)
  const cancel = useCancelOrder()
  const data = list.data
  const waiting = (data?.orders ?? []).filter((o) => o.status === 'SENT')
  const received = (data?.orders ?? []).filter((o) => o.status === 'RECEIVED')
  const inList = new Set((data?.groups ?? []).flatMap((g) => g.items.map((i) => i.supplyId)))
  const inOrders = new Set(waiting.flatMap((o) => o.items.map((i) => i.supplyId)))
  const addable = supplies.filter((s) => !inList.has(s.id) && !inOrders.has(s.id))

  return (
    <div className="calm-stack purchase">
      <HeadTools>
        {data && data.count > 0 && <span className="hint">К заказу: {data.count}</span>}
        <button type="button" className="btn" onClick={() => setDirectory(true)}>Поставщики</button>
        <button type="button" className="btn head-end" onClick={() => setAdding(true)} disabled={addable.length === 0}>＋ В заказ</button>
      </HeadTools>

      {adding && <AddToOrder supplies={addable} onClose={() => setAdding(false)} />}
      {list.isPending && <Loading />}
      {list.error && <p className="error">{list.error.message}</p>}
      {data && data.groups.length === 0 && waiting.length === 0 && (
        <EmptyState fill title="Заказывать нечего">
          Материал опустится до минимума — он сам появится здесь, с количеством на месяц. Нужно что-то ещё — «＋ В заказ».
        </EmptyState>
      )}
      {(suppliers.data?.length ?? 0) === 0 && (data?.groups.length ?? 0) > 0 && (
        <p className="hint">Добавьте поставщиков — «Поставщики»: тогда заказ уйдёт в WhatsApp готовым текстом.</p>
      )}

      {data?.groups.map((g) => (
        <GroupBlock key={`${g.supplierId ?? 'none'}-${g.doctorId ?? 'clinic'}`} group={g} me={me} suppliers={suppliers.data ?? []} />
      ))}

      {waiting.length > 0 && (
        <section className="calm-day" aria-label="Отправлено — ждём">
          <h3>Отправлено — ждём <span className="hint">{waiting.length}</span></h3>
          <ul className="calm-list">
            {waiting.map((o) => {
              const items: MenuItem[] = [{
                label: 'Отменить заказ', tone: 'bad', onSelect: async () => {
                  if (await ask(`Отменить заказ у «${o.supplierName}»? Материалы вернутся в список к заказу.`, { ok: 'Отменить заказ' })) cancel.mutate(o.id)
                },
              }]
              return (
                <CalmRow key={o.id} open={() => setReceiving(o)}
                  name={`«${o.supplierName}»`}
                  sub={[o.doctorName ? `склад: ${o.doctorName}` : null, itemsText(o.items)].filter(Boolean).join(' · ')}
                  meta={<span>Отправлен {dayText(o.sentAt)}</span>}
                  action={<button type="button" className="btn small" aria-label={`Пришло: ${o.supplierName}`} onClick={() => setReceiving(o)}>Пришло</button>}
                  menu={<RowMenu label={`Ещё: заказ у ${o.supplierName}`} items={items} />}
                />
              )
            })}
          </ul>
          {cancel.error && <p className="error" role="alert">{cancel.error.message}</p>}
        </section>
      )}

      {received.length > 0 && (
        <Fold title="Пришло недавно" meta={received.length} label="Пришедшие заказы">
          <ul className="calm-list">
            {received.map((o) => (
              <CalmRow key={o.id} open={null} name={`«${o.supplierName}»`}
                sub={itemsText(o.items.filter((i) => (i.received ?? 0) > 0).map((i) => ({ ...i, quantity: i.received ?? 0 })))}
                meta={o.closedAt ? <span>Пришло {dayText(o.closedAt)}</span> : undefined} />
            ))}
          </ul>
        </Fold>
      )}

      {directory && <SuppliersDialog me={me} onClose={() => setDirectory(false)} />}
      {receiving && <ReceiveSheet order={receiving} money={!isAssistant(me)} onClose={() => setReceiving(null)} />}
    </div>
  )
}

/** Поставщик (и склад): что заказать, количество, «Отправить в WhatsApp». */
function GroupBlock({ group: g, me, suppliers }: { group: DraftGroup; me: Me; suppliers: Schemas['PurchaseViewsSupplierView'][] }) {
  const send = useSendOrder()
  const order = useSupplyOrder()
  const lines = g.items.filter((i) => i.toOrder > 0)
  const title = g.supplierName ? `«${g.supplierName}»` : 'Поставщик не выбран'
  const label = g.supplierName ? `Заказ у ${g.supplierName}` : 'Без поставщика'
  const submit = () => {
    if (g.supplierId == null || lines.length === 0) return
    send.mutate({ supplierId: g.supplierId, items: lines.map((i) => ({ supplyId: i.supplyId, quantity: i.toOrder })) }, {
      // Письмо — в WhatsApp поставщика; номера нет — заказ просто отмечен (звонили или написали сами)
      onSuccess: (r) => { if (g.supplierPhone) openLink(whatsappUrl(g.supplierPhone, r.text)) },
    })
  }
  return (
    <section className="calm-day purchase-group" aria-label={label}>
      <h3>
        {title}
        {g.doctorName && <span className="hint"> · склад: {g.doctorName}</span>}
        {g.supplierPhone && <span className="hint num"> · {formatPhone(g.supplierPhone)}</span>}
      </h3>
      {g.supplierNote && <p className="calm-note">{g.supplierNote}</p>}
      <ul className="calm-list">
        {g.items.map((i) => (
          // Ключ с количеством: сервер пересчитал — поле начинается заново с его числа
          <ItemRow key={`${i.supplyId}-${i.toOrder}`} item={i} group={g} me={me} suppliers={suppliers} saving={order} />
        ))}
      </ul>
      {g.supplierId != null && (
        <div className="purchase-send">
          {g.supplierPhone
            ? <button type="button" className="btn" data-tone="wa" disabled={send.isPending || order.isPending || lines.length === 0} onClick={submit}>
              Отправить в WhatsApp
            </button>
            : <button type="button" className="btn" disabled={send.isPending || order.isPending || lines.length === 0} onClick={submit}>
              Отметить: заказали
            </button>}
          <span className="hint">
            {lines.length === 0 ? 'Нечего отправлять: у всех позиций 0'
              : g.supplierPhone ? `${lines.length} поз. — откроется WhatsApp с готовым текстом` : 'Нет номера поставщика — добавьте в «Поставщики», чтобы слать в WhatsApp'}
          </span>
          {send.error && <p className="error" role="alert">{send.error.message}</p>}
        </div>
      )}
      {g.message && (
        <Fold title="Текст заказа" label={`Текст заказа: ${g.supplierName}`}>
          <pre className="purchase-text">{g.message}</pre>
        </Fold>
      )}
    </section>
  )
}

/** Позиция: сколько осталось и ушло за месяц, количество к заказу (сохраняется при уходе с поля). */
function ItemRow({ item: i, group: g, me, suppliers, saving }: {
  item: DraftItem
  group: DraftGroup
  me: Me
  suppliers: Schemas['PurchaseViewsSupplierView'][]
  saving: ReturnType<typeof useSupplyOrder>
}) {
  const [value, setValue] = useState(String(i.toOrder))
  const save = (quantity: number | null, wanted = i.wanted) => saving.mutate({ supplyId: i.supplyId, supplierId: g.supplierId, wanted, quantity })
  const commit = () => {
    const n = Number(value)
    if (value.trim() === '' || !Number.isInteger(n) || n < 0) {
      setValue(String(i.toOrder))
      return
    }
    if (n !== i.toOrder) save(n === i.suggested ? null : n)
  }
  const sub = [
    i.quantity === 0 ? 'закончился' : `осталось ${i.quantity} ${i.unit}`,
    `мин. ${i.minQuantity}`,
    i.usedMonth > 0 ? `за 30 дней ушло ${i.usedMonth}` : null,
    i.lastPriceSom != null && !isAssistant(me) ? `было ${somText(i.lastPriceSom)}/${i.unit}` : null,
    i.wanted && !i.low ? 'добавлено вручную' : null,
  ].filter(Boolean).join(' · ')
  const menu: MenuItem[] = []
  if (i.orderQuantity != null) menu.push({ label: `Как предложено: ${i.suggested}`, onSelect: () => save(null) })
  if (i.toOrder > 0) menu.push({ label: 'Не заказывать в этот раз', onSelect: () => (i.low ? save(0) : save(null, false)) })
  else if (i.low) menu.push({ label: 'Вернуть в заказ', onSelect: () => save(null) })
  return (
    <CalmRow open={null}
      name={<span className={i.toOrder === 0 ? 'purchase-skip' : undefined}>{i.name}</span>}
      sub={sub}
      action={g.supplierId == null ? (
        <Select aria-label={`Поставщик: ${i.name}`} value="" onChange={(e) => {
          if (e.target.value) saving.mutate({ supplyId: i.supplyId, supplierId: Number(e.target.value), wanted: i.wanted, quantity: i.orderQuantity })
        }}>
          <option value="">Где берём?</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      ) : (
        <label className="purchase-qty">
          <input type="number" min={0} inputMode="numeric" aria-label={`Сколько заказать: ${i.name}`} value={value}
            onChange={(e) => setValue(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }} />
          <span className="hint">{i.unit}</span>
        </label>
      )}
      menu={menu.length ? <RowMenu label={`Ещё: ${i.name}`} items={menu} /> : undefined}
    />
  )
}

/** «＋ В заказ»: материал, которого нет в списке (не ниже порога, но нужен). */
function AddToOrder({ supplies, onClose }: { supplies: Schemas['SupplyView'][]; onClose: () => void }) {
  const order = useSupplyOrder()
  return (
    <div className="purchase-add" role="group" aria-label="Добавить в заказ">
      <Select aria-label="Материал в заказ" value="" onChange={(e) => {
        const s = supplies.find((x) => x.id === Number(e.target.value))
        if (s) order.mutate({ supplyId: s.id, supplierId: s.supplierId, wanted: true }, { onSuccess: onClose })
      }}>
        <option value="">Выберите материал</option>
        {supplies.map((s) => <option key={s.id} value={s.id}>{s.name}{s.supplierName ? ` · ${s.supplierName}` : ''}</option>)}
      </Select>
      <button type="button" className="btn ghost small" onClick={onClose}>Отмена</button>
      {order.error && <p className="error" role="alert">{order.error.message}</p>}
    </div>
  )
}
