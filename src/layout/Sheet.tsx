import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { CloseButton, SheetHead } from './SheetHead'
import { useSwipeDown } from './useSwipeDown'

/**
 * Окно поверх карточки: компьютер — по центру, телефон — лист снизу (свайп вниз, «назад» и фон закрывают), как
 * ReasonSheet и подтверждения. Сверху — заголовок и ✕ (layout/SheetHead). Для «📄 Шаблон», «Из прошлого визита», «Сохранить как шаблон». Esc закрывает только
 * окно, а не карточку приёма под ним.
 */
export function Sheet({ label, title, onClose, children, wide }: {
  label: string
  /** Заголовок сверху окна */
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Шире на компьютере (списки с текстом) */
  wide?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  useBack(onClose)
  useSwipeDown(box, phone ? onClose : null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.focus({ preventScroll: true })
    return () => back?.focus?.({ preventScroll: true })
  }, [])
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className={['confirm', 'tool-sheet', phone && 'sheet', wide && 'wide'].filter(Boolean).join(' ')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        {title ? <SheetHead title={title} level={3} className="tool-sheet-head" onClose={onClose} /> : <CloseButton className="tool-sheet-x" onClick={onClose} />}
        {children}
      </div>
    </div>,
    document.body,
  )
}
