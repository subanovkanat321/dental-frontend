import type { Schemas } from '../../api/client'
import { DirectoryEntryForm, type DirectoryWords } from '../../clinic/DirectoryEntryForm'
import { DirectorySheet } from '../../clinic/DirectorySheet'
import { useArchiveSupplier, useSaveSupplier, useSuppliers, type Supplier } from './api'

type Me = Schemas['BookingViewsMe']

const WORDS: DirectoryWords = {
  one: 'Поставщик', newOne: 'Новый поставщик', add: 'Добавить поставщика',
  namePlaceholder: 'Например: Дент-Маркет', notePlaceholder: 'Доставка в тот же день',
}

/**
 * Поставщики клиники — тот же лист, что «Лаборатории» (DirectorySheet): название, номер (звонок и WhatsApp;
 * WhatsApp может быть на другом номере), заметка. Убрать из списка — руководитель и регистратура (старые заказы и
 * цены остаются); у материалов «где берём» станет пусто.
 */
export function SuppliersDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const suppliers = useSuppliers()
  const archive = useArchiveSupplier()
  return (
    <DirectorySheet<Supplier> title="Поставщики" intro="Склады, у которых берёте материалы: номер — для заказа в WhatsApp и звонка."
      items={suppliers.data} pending={suppliers.isPending} addText="＋ Поставщик" onClose={onClose}
      archive={me.admin || me.reception ? { keeps: 'Старые заказы и цены останутся.', run: archive.mutate, error: archive.error } : null}
      form={(s, done, cancel) => <SupplierForm supplier={s} onSaved={done} onCancel={cancel} />} />
  )
}

function SupplierForm({ supplier, onSaved, onCancel }: { supplier?: Supplier; onSaved: () => void; onCancel: () => void }) {
  const save = useSaveSupplier()
  return <DirectoryEntryForm entry={supplier} words={WORDS} save={save} onSaved={onSaved} onCancel={onCancel} />
}
