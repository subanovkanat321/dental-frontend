import type { ReactNode } from 'react'

/**
 * Закрыть окно, лист или панель — один вид везде (2026-11-20, владелец: «Закрыть» и «Готово» текстом в разных
 * местах выглядели по-разному): ✕ линией в правом верхнем углу, касание 44×44, как ✕ карточки приёма и пациента.
 * Имя для читалок экрана — «Закрыть». Настоящие действия (Сохранить, Отправить, Печать, Отмена в подтверждениях)
 * остаются кнопками с текстом.
 */
export function CloseButton({ onClick, label = 'Закрыть', className }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button type="button" className={className ? `x-btn ${className}` : 'x-btn'} aria-label={label} title="Закрыть" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  )
}

/**
 * Шапка окна или листа: заголовок, необязательная строка под ним (о ком, о чём) и ✕ справа. `id` — для
 * `aria-labelledby` окна; `level` — h2 (окно) или h3 (лист внутри карточки).
 */
export function SheetHead({ title, subtitle, onClose, id, level = 2, className }: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  id?: string
  level?: 2 | 3
  className?: string
}) {
  const H = level === 3 ? 'h3' : 'h2'
  return (
    <div className={className ? `sheet-head ${className}` : 'sheet-head'}>
      <div className="sheet-head-text">
        <H id={id} className="sheet-head-title">{title}</H>
        {subtitle && <p className="sheet-head-sub">{subtitle}</p>}
      </div>
      <CloseButton onClick={onClose} />
    </div>
  )
}
