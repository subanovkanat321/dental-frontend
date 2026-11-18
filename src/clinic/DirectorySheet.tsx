import { useState, type ReactNode } from 'react'

import { ask } from '../lib/confirm'
import { Loading } from '../layout/Loading'
import { Sheet } from '../lab/LabOrderDialog'
import { DirectoryEntryHint, type DirectoryEntry } from './DirectoryEntryForm'

/**
 * Лист справочника — «Лаборатории» и «Поставщики» одинаково: строка-подсказка вверху (всегда — зачем этот список),
 * записи «название / телефон · WhatsApp … · заметка» с «Изменить» и «Убрать», «＋ …» и «Готово».
 * Список пуст — сразу форма (лишнее нажатие ни к чему), «Отмена» тогда закрывает лист. Пока форма открыта,
 * «Готово» нет: иначе лист закрылся бы и введённое пропало без сохранения.
 */
export function DirectorySheet<T extends DirectoryEntry>({ title, intro, items, pending, addText, archive, form, onClose }: {
  title: string
  intro: string
  items: T[] | undefined
  pending: boolean
  /** «＋ Лаборатория» */
  addText: string
  /** «Убрать»: что останется (в вопросе) и действие; null — убирать нельзя (нет прав) */
  archive: { keeps: string; run: (id: number) => void; error: Error | null } | null
  /** Форма записи: entry — правка, без него — новая */
  form: (entry: T | undefined, done: () => void, cancel: () => void) => ReactNode
  onClose: () => void
}) {
  const [editing, setEditing] = useState<T | 'new' | null>(null)
  const empty = items?.length === 0
  const adding = editing === 'new' || (empty && editing == null)
  const done = () => setEditing(null)
  return (
    <Sheet title={title} onClose={onClose} onSubmit={(e) => e.preventDefault()} className="lab-directory">
      <p className="hint">{intro}</p>
      {pending && <Loading />}
      {!empty && items && (
        <ul className="dir-list">
          {items.map((it) => (
            <li key={it.id} className={editing !== 'new' && editing?.id === it.id ? 'editing' : undefined}>
              {editing !== 'new' && editing?.id === it.id ? form(it, done, done) : (
                <>
                  <span className="dir-item">
                    <strong>{it.name}</strong>
                    <DirectoryEntryHint entry={it} />
                  </span>
                  <span className="dir-item-actions">
                    <button type="button" className="btn ghost small" onClick={() => setEditing(it)}>Изменить</button>
                    {archive && (
                      <button type="button" className="btn ghost small" onClick={async () => {
                        if (await ask(`Убрать «${it.name}» из списка? ${archive.keeps}`, { ok: 'Убрать' })) archive.run(it.id)
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
        ? form(undefined, done, () => (empty && editing == null ? onClose() : done()))
        : items && editing == null && <button type="button" className="btn dir-add" onClick={() => setEditing('new')}>{addText}</button>}
      {archive?.error && <p className="error" role="alert">{archive.error.message}</p>}
      {editing == null && !adding && (
        <div className="confirm-actions">
          <button type="button" className="btn primary" onClick={onClose}>Готово</button>
        </div>
      )}
    </Sheet>
  )
}
