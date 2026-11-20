import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import './attention.css'
import { SheetHead } from '../layout/SheetHead'

/**
 * Окно из полосы «Требует внимания» («🔔 Окна», «🎂 Дни рождения»): как «Попросите оценку» — по центру на компьютере,
 * снизу на телефоне; Esc, «Назад» и нажатие мимо закрывают.
 */
export function AttentionDialog({ title, labelId, onClose, children }: { title: string; labelId: string; onClose: () => void; children: ReactNode }) {
  useBack(onClose)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => back?.focus?.()
  }, [])
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelId} className="confirm attention-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <SheetHead id={labelId} title={title} onClose={onClose} />
        {children}
      </div>
    </div>,
    document.body,
  )
}
