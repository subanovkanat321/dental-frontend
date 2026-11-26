import { useState, type ReactNode } from 'react'

/**
 * Строка-раскрывашка карточки: «Зубы · 14, 36 ▾» — нажали, открылось содержимое. Так в карточке
 * приёма видно, что есть (счётчик или коротко), а подробности не занимают место, пока не нужны.
 * Кнопка с aria-expanded, а не <details>: состояние держит React (тесты, «открыть сразу»).
 */
export function Fold({ title, meta, badge, sub, label, defaultOpen = false, onToggle, children }: {
  title: string
  /** Коротко справа: счётчик или «не отмечены» */
  meta?: ReactNode
  /** Рядом с заголовком: чип статуса («Предложен») */
  badge?: ReactNode
  /** Строка под заголовком — когда «коротко справа» длинное и на телефоне не влезло бы в одну строку */
  sub?: ReactNode
  /** Имя области для скринридера (и тестов), если отличается от заголовка */
  label?: string
  defaultOpen?: boolean
  /** Открыли или закрыли: например, загрузить содержимое только при первом открытии */
  onToggle?: (open: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={open ? 'fold open' : 'fold'} aria-label={label ?? title}>
      <button type="button" className={sub != null ? 'fold-head has-sub' : 'fold-head'} aria-expanded={open} onClick={() => { setOpen(!open); onToggle?.(!open) }}>
        <span className="fold-title">{title}</span>
        {badge != null && <span className="fold-badge">{badge}</span>}
        {meta != null && meta !== '' && <span className="fold-meta">{meta}</span>}
        {sub != null && <span className="fold-sub">{sub}</span>}
        <span className="fold-chev" aria-hidden="true">›</span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  )
}
