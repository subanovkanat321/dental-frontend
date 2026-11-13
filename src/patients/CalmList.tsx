import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { rowOpen } from '../lib/rowClick'
import './calm.css'

/**
 * Спокойная строка списков «Пациентов» (DESIGN.md → «Пациенты — спокойный список»): имя крупно, под ним
 * одна серая строка по смыслу вкладки, справа — дата или сумма серым, одно видимое действие и «⋯» с
 * остальным. Значки (`flags`) — только то, что требует действия: заявка, план согласован. Вся строка
 * открывает карточку (`rowOpen`), имя — настоящая кнопка для Tab и скринридера.
 */
export function CalmRow({ open, active, lead, name, flags, sub, meta, action, menu, children }: {
  /** Открыть карточку пациента (или приёма, вопроса); пусто — строка не кликабельна */
  open: (() => void) | null | false
  active?: boolean
  /** Слева от имени — время записи («Записаны») */
  lead?: ReactNode
  name: ReactNode
  flags?: ReactNode
  sub?: ReactNode
  meta?: ReactNode
  /** Одно главное действие вкладки */
  action?: ReactNode
  /** «⋯» — второстепенные действия (RowMenu) */
  menu?: ReactNode
  /** Под строкой во всю ширину: раскрытая форма, ошибка */
  children?: ReactNode
}) {
  return (
    <li {...rowOpen(open, 'calm-row', lead != null && 'with-lead', active && 'active')}>
      {lead != null && <span className="calm-lead num">{lead}</span>}
      <span className="calm-main">
        <span className="calm-title">
          {open ? <button type="button" className="row-link calm-name" onClick={open}>{name}</button> : <strong className="calm-name">{name}</strong>}
          {flags}
        </span>
        {sub && <span className="calm-sub">{sub}</span>}
      </span>
      {meta != null && meta !== false && <span className="calm-meta">{meta}</span>}
      {(action || menu) && <span className="calm-act">{action}{menu}</span>}
      {children && <div className="calm-extra">{children}</div>}
    </li>
  )
}

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; tone?: 'bad' }

/**
 * «⋯» в строке: второстепенные действия (записать, не звать). Меню под кнопкой, Esc и нажатие мимо
 * закрывают; пункты — role=menuitem, строку они не открывают (lib/rowClick).
 */
export function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    // Клавиатура: фокус — на первый пункт, Esc — закрыть и вернуть фокус на «⋯»
    box.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      box.current?.querySelector<HTMLButtonElement>('.row-menu-btn')?.focus()
    }
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])
  if (!items.length) return null
  return (
    <span className="row-menu" ref={box}>
      <button type="button" className="row-menu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <span className="row-menu-pop" id={id} role="menu" aria-label={label}>
          {items.map((i) => (
            <button key={i.label} type="button" role="menuitem" className={i.tone === 'bad' ? 'tone-bad' : undefined} disabled={i.disabled}
              onClick={() => { setOpen(false); i.onSelect() }}>{i.label}</button>
          ))}
        </span>
      )}
    </span>
  )
}
