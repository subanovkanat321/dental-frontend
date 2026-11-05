import { useState, type ReactNode } from 'react'

/**
 * Строка-раскрывашка карточки: «Зубы · 14, 36 ▾» — нажали, открылось содержимое. Так в карточке
 * приёма видно, что есть (счётчик или коротко), а подробности не занимают место, пока не нужны.
 * Кнопка с aria-expanded, а не <details>: состояние держит React (тесты, «открыть сразу»).
 */
export function Fold({ title, meta, label, defaultOpen = false, children }: {
  title: string
  /** Коротко справа: счётчик или «не отмечены» */
  meta?: ReactNode
  /** Имя области для скринридера (и тестов), если отличается от заголовка */
  label?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={open ? 'fold open' : 'fold'} aria-label={label ?? title}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fold-title">{title}</span>
        {meta != null && meta !== '' && <span className="fold-meta">{meta}</span>}
        <span className="fold-chev" aria-hidden="true">›</span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  )
}
