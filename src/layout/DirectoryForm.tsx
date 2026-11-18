import type { ReactNode } from 'react'

/**
 * Форма записи справочника — поставщик, лаборатория: подписи над полями (`label.field`), как в карточке пациента
 * и «＋ Сотрудник», и кнопки внизу. Своего `<form>` нет: она живёт внутри листа (`Sheet` — это уже `<form>`), а
 * вложенные формы HTML не разрешает. Поэтому Enter в текстовом поле сохраняет здесь сам, а не отправляет лист.
 *
 * @param primary «Добавить» — главная (залитая) кнопка области: в листе-справочнике да; внутри «Заказа в
 *   лабораторию» главная — «Создать заказ», там эта — белая с рамкой (DESIGN.md: одна залитая на форму)
 */
export function DirectoryForm({ label, saveText, canSave, busy, error, onSave, onCancel, primary = true, children }: {
  label: string
  saveText: string
  canSave: boolean
  busy: boolean
  error?: string | null
  onSave: () => void
  onCancel?: () => void
  primary?: boolean
  children: ReactNode
}) {
  const save = () => { if (canSave && !busy) onSave() }
  return (
    <div className="dir-form" role="group" aria-label={label} onKeyDown={(e) => {
      if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
      e.preventDefault()
      save()
    }}>
      {children}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dir-form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Отмена</button>}
        <button type="button" className={primary ? 'btn primary' : 'btn'} disabled={!canSave || busy} onClick={save}>{saveText}</button>
      </div>
    </div>
  )
}
