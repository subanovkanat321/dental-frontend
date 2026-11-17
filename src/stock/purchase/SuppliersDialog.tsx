import { useState } from 'react'

import type { Schemas } from '../../api/client'
import { ask } from '../../lib/confirm'
import { formatPhone } from '../../lib/time'
import { Loading } from '../../layout/Loading'
import { Sheet } from '../../lab/LabOrderDialog'
import { useArchiveSupplier, useSaveSupplier, useSuppliers, type Supplier } from './api'

type Me = Schemas['BookingViewsMe']

/**
 * Поставщики клиники: название, номер (WhatsApp и звонок), заметка («доставка в тот же день»). Убрать из списка —
 * руководитель и регистратура (старые заказы и цены остаются); у материалов «где берём» станет пусто.
 */
export function SuppliersDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const suppliers = useSuppliers()
  const archive = useArchiveSupplier()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const canArchive = Boolean(me.admin || me.reception)
  return (
    <Sheet title="Поставщики" onClose={onClose} onSubmit={(e) => e.preventDefault()} className="lab-directory">
      {suppliers.isPending && <Loading />}
      {suppliers.data?.length === 0 && editing == null && <p className="hint">Список пуст — добавьте склад, у которого берёте материалы.</p>}
      <ul className="lab-directory-list">
        {(suppliers.data ?? []).map((s) => (
          <li key={s.id}>
            {editing !== 'new' && editing?.id === s.id ? (
              <SupplierForm supplier={s} onDone={() => setEditing(null)} />
            ) : (
              <>
                <span>
                  <strong>{s.name}</strong>{s.phone && <span className="hint num"> · {formatPhone(s.phone)}</span>}
                  {s.note && <span className="hint"> · {s.note}</span>}
                </span>
                <span className="row">
                  <button type="button" className="btn ghost small" onClick={() => setEditing(s)}>Изменить</button>
                  {canArchive && (
                    <button type="button" className="btn ghost small" onClick={async () => {
                      if (await ask(`Убрать «${s.name}» из списка? Старые заказы и цены останутся.`, { ok: 'Убрать' })) archive.mutate(s.id)
                    }}>Убрать</button>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new'
        ? <SupplierForm onDone={() => setEditing(null)} />
        : <button type="button" className="btn" onClick={() => setEditing('new')}>＋ Поставщик</button>}
      {archive.error && <p className="error" role="alert">{archive.error.message}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn primary" onClick={onClose}>Готово</button>
      </div>
    </Sheet>
  )
}

function SupplierForm({ supplier, onDone }: { supplier?: Supplier; onDone: () => void }) {
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ? `+${supplier.phone}` : '')
  const [note, setNote] = useState(supplier?.note ?? '')
  const save = useSaveSupplier()
  const err = save.error ? Object.values(save.error.fieldErrors)[0] ?? save.error.message : null
  const submit = () => {
    if (!name.trim()) return
    save.mutate({ id: supplier?.id, body: { name, phone: phone.trim() || undefined, note: note.trim() || undefined } }, { onSuccess: onDone })
  }
  return (
    <div className="lab-form" role="group" aria-label={supplier ? `Поставщик ${supplier.name}` : 'Новый поставщик'}>
      <input aria-label="Название поставщика" placeholder="Название: «Дент-Маркет»" value={name} maxLength={80}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
      <input aria-label="Телефон / WhatsApp" placeholder="Телефон / WhatsApp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input aria-label="Заметка" placeholder="Заметка: доставка в тот же день" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button type="button" className="btn small" disabled={!name.trim() || save.isPending} onClick={submit}>{supplier ? 'Сохранить' : 'Добавить'}</button>
        <button type="button" className="btn ghost small" onClick={onDone}>Отмена</button>
      </div>
    </div>
  )
}
