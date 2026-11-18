import { useState } from 'react'

import type { Schemas } from '../../api/client'
import { ask } from '../../lib/confirm'
import { formatPhone } from '../../lib/time'
import { PhoneWhatsappFields } from '../../clinic/PhoneWhatsappFields'
import { phoneFromInput, phoneToInput, whatsappToInput } from '../../clinic/phone'
import { DirectoryForm } from '../../layout/DirectoryForm'
import { Loading } from '../../layout/Loading'
import { Sheet } from '../../lab/LabOrderDialog'
import { useArchiveSupplier, useSaveSupplier, useSuppliers, type Supplier } from './api'

type Me = Schemas['BookingViewsMe']

/**
 * Поставщики клиники: название, номер (звонок и WhatsApp; WhatsApp может быть на другом номере), заметка
 * («доставка в тот же день»). Убрать из списка — руководитель и регистратура (старые заказы и цены остаются); у материалов «где берём» станет пусто.
 */
export function SuppliersDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const suppliers = useSuppliers()
  const archive = useArchiveSupplier()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const canArchive = Boolean(me.admin || me.reception)
  // Список пуст — сразу форма: «＋ Поставщик» был бы лишним нажатием; «Отмена» тогда закрывает лист
  const empty = suppliers.data?.length === 0
  const adding = editing === 'new' || (empty && editing == null)
  return (
    <Sheet title="Поставщики" onClose={onClose} onSubmit={(e) => e.preventDefault()} className="lab-directory">
      {suppliers.isPending && <Loading />}
      {empty && <p className="hint">Здесь склады, у которых берёте материалы: номер — для заказа в WhatsApp и звонка.</p>}
      {!empty && (
        <ul className="dir-list">
          {(suppliers.data ?? []).map((s) => (
            <li key={s.id} className={editing !== 'new' && editing?.id === s.id ? 'editing' : undefined}>
              {editing !== 'new' && editing?.id === s.id ? (
                <SupplierForm supplier={s} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <span className="dir-item">
                    <strong>{s.name}</strong>
                    <SupplierHint supplier={s} />
                  </span>
                  <span className="dir-item-actions">
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
      )}
      {adding
        ? <SupplierForm onSaved={() => setEditing(null)} onCancel={() => (empty && editing == null ? onClose() : setEditing(null))} />
        : suppliers.data && editing == null && <button type="button" className="btn dir-add" onClick={() => setEditing('new')}>＋ Поставщик</button>}
      {archive.error && <p className="error" role="alert">{archive.error.message}</p>}
      {/* Пока открыта форма, «Готово» нет: иначе лист закрылся бы и введённое пропало без сохранения */}
      {editing == null && !adding && (
        <div className="confirm-actions">
          <button type="button" className="btn primary" onClick={onClose}>Готово</button>
        </div>
      )}
    </Sheet>
  )
}

/** Под названием: телефон, «WhatsApp …» — если на другом номере (как у лаборатории), заметка — через «·». */
function SupplierHint({ supplier: s }: { supplier: Supplier }) {
  const parts = [
    s.phone && <span key="phone" className="nowrap">{formatPhone(s.phone)}</span>,
    s.whatsapp && s.whatsapp !== s.phone && <span key="wa">WhatsApp <span className="nowrap">{formatPhone(s.whatsapp)}</span></span>,
    s.note && <span key="note">{s.note}</span>,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return <span className="hint">{parts.flatMap((p, i) => (i ? [' · ', p] : [p]))}</span>
}

/** Поставщик: название, номер — как у лаборатории (PhoneWhatsappFields, +996 и страна, как у пациента), заметка. */
function SupplierForm({ supplier, onSaved, onCancel }: { supplier?: Supplier; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(phoneToInput(supplier?.phone))
  const [whatsapp, setWhatsapp] = useState(whatsappToInput(supplier))
  const [note, setNote] = useState(supplier?.note ?? '')
  const save = useSaveSupplier()
  const err = (k: string) => save.error?.fieldErrors[k]
  const other = save.error && !err('name') && !err('phone') && !err('whatsapp') ? Object.values(save.error.fieldErrors)[0] ?? save.error.message : null
  return (
    <DirectoryForm label={supplier ? `Поставщик ${supplier.name}` : 'Новый поставщик'} saveText={supplier ? 'Сохранить' : 'Добавить'}
      canSave={Boolean(name.trim())} busy={save.isPending} error={other} onCancel={onCancel}
      onSave={() => save.mutate({
        id: supplier?.id,
        body: { name: name.trim(), phone: phoneFromInput(phone) || undefined, whatsapp: phoneFromInput(whatsapp) || undefined,
          note: note.trim() || undefined },
      }, { onSuccess: onSaved })}>
      <label className="field"><span>Название</span>
        <input value={name} maxLength={80} autoComplete="off" autoFocus={!supplier} placeholder="Например: Дент-Маркет" onChange={(e) => setName(e.target.value)} /></label>
      {err('name') && <p className="error">{err('name')}</p>}
      <PhoneWhatsappFields phone={phone} whatsapp={whatsapp} onPhone={setPhone} onWhatsapp={setWhatsapp}
        phoneError={err('phone')} whatsappError={err('whatsapp')} />
      <label className="field"><span>Заметка <span className="hint">— необязательно</span></span>
        <input value={note} maxLength={200} autoComplete="off" placeholder="Доставка в тот же день" onChange={(e) => setNote(e.target.value)} /></label>
    </DirectoryForm>
  )
}
