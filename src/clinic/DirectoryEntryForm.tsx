import { useState } from 'react'

import type { ApiError } from '../api/client'
import { formatPhone } from '../lib/time'
import { DirectoryForm } from '../layout/DirectoryForm'
import { phoneFromInput, phoneToInput, whatsappToInput } from './phone'
import { PhoneWhatsappFields } from './PhoneWhatsappFields'

/** Запись справочника клиники — лаборатория, поставщик: у обоих одни и те же поля (LabView, SupplierView). */
export type DirectoryEntry = {
  id: number
  name: string
  phone?: string | null
  whatsapp?: string | null
  note?: string | null
}

/** Что уходит на сервер (LabDraft, SupplierDraft): как набрано, нормализует и проверяет сервер. */
export type DirectoryEntryBody = { name: string; phone?: string; whatsapp?: string; note?: string }

/** Слова формы — единственное, чем лаборатория отличается от поставщика. */
export type DirectoryWords = {
  /** «Лаборатория» — подпись группы полей при правке: «Лаборатория Дент-Лаб» */
  one: string
  /** «Новая лаборатория» */
  newOne: string
  /** «Добавить лабораторию» — кнопка новой записи (у правки — «Сохранить») */
  add: string
  namePlaceholder: string
  notePlaceholder: string
}

/** useSaveLab / useSaveSupplier: мутация с одинаковой формой запроса. */
type SaveMutation<T> = {
  mutate(vars: { id?: number; body: DirectoryEntryBody }, options: { onSuccess: (saved: T) => void }): void
  isPending: boolean
  error: ApiError | null
}

/**
 * Форма записи справочника — одна на лабораторию и поставщика, чтобы они не расходились: «Название»,
 * «Телефон / WhatsApp», «＋ WhatsApp на другом номере» (PhoneWhatsappFields), «Заметка»; кнопки «Отмена» и
 * «Добавить …» / «Сохранить» (DirectoryForm).
 * @param primary «Добавить» залитой: в справочнике да, внутри «Заказа в лабораторию» — нет (там главная «Создать заказ»)
 */
export function DirectoryEntryForm<T>({ entry, words, save, onSaved, onCancel, primary = true }: {
  entry?: DirectoryEntry
  words: DirectoryWords
  save: SaveMutation<T>
  onSaved: (saved: T) => void
  onCancel?: () => void
  primary?: boolean
}) {
  const [name, setName] = useState(entry?.name ?? '')
  const [phone, setPhone] = useState(phoneToInput(entry?.phone))
  const [whatsapp, setWhatsapp] = useState(whatsappToInput(entry))
  const [note, setNote] = useState(entry?.note ?? '')
  const err = (k: string) => save.error?.fieldErrors[k]
  const other = save.error && !err('name') && !err('phone') && !err('whatsapp') && !err('note')
    ? Object.values(save.error.fieldErrors)[0] ?? save.error.message : null
  return (
    <DirectoryForm label={entry ? `${words.one} ${entry.name}` : words.newOne} saveText={entry ? 'Сохранить' : words.add}
      canSave={Boolean(name.trim())} busy={save.isPending} error={other} onCancel={onCancel} primary={primary}
      onSave={() => save.mutate({
        id: entry?.id,
        body: { name: name.trim(), phone: phoneFromInput(phone) || undefined, whatsapp: phoneFromInput(whatsapp) || undefined,
          note: note.trim() || undefined },
      }, { onSuccess: onSaved })}>
      <label className="field"><span>Название</span>
        {/* Фокус — только в листе-справочнике: внутри «Заказа в лабораторию» он увёл бы экран от заказа */}
        <input value={name} maxLength={80} autoComplete="off" autoFocus={!entry && primary} placeholder={words.namePlaceholder}
          onChange={(e) => setName(e.target.value)} /></label>
      {err('name') && <p className="error">{err('name')}</p>}
      <PhoneWhatsappFields phone={phone} whatsapp={whatsapp} onPhone={setPhone} onWhatsapp={setWhatsapp}
        phoneError={err('phone')} whatsappError={err('whatsapp')} />
      <label className="field"><span>Заметка <span className="hint">— необязательно</span></span>
        <input value={note} maxLength={200} autoComplete="off" placeholder={words.notePlaceholder} onChange={(e) => setNote(e.target.value)} /></label>
      {err('note') && <p className="error">{err('note')}</p>}
    </DirectoryForm>
  )
}

/** Строка под названием в списке: «телефон · WhatsApp … (если на другом номере) · заметка». */
export function DirectoryEntryHint({ entry: e }: { entry: DirectoryEntry }) {
  const parts = [
    e.phone && <span key="phone" className="nowrap">{formatPhone(e.phone)}</span>,
    e.whatsapp && e.whatsapp !== e.phone && <span key="wa">WhatsApp <span className="nowrap">{formatPhone(e.whatsapp)}</span></span>,
    e.note && <span key="note">{e.note}</span>,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return <span className="hint">{parts.flatMap((p, i) => (i ? [' · ', p] : [p]))}</span>
}
