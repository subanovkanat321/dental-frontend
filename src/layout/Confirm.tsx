import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { pending as current, subscribe } from '../lib/confirm'

/** Окно подтверждения для `ask` (lib/confirm): компьютер — по центру, телефон — лист снизу. */
export function ConfirmHost() {
  const pending = useSyncExternalStore(subscribe, current)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!pending) return
    const back = document.activeElement as HTMLElement | null
    okRef.current?.focus()
    return () => back?.focus?.()
  }, [pending])
  if (!pending) return null
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && pending.resolve(false)}>
      <div role="alertdialog" aria-modal="true" aria-label="Подтверждение" aria-describedby="confirm-text"
        className={phone ? 'confirm sheet' : 'confirm'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            pending.resolve(false)
          }
        }}>
        <p id="confirm-text">{pending.text}</p>
        <div className="confirm-actions">
          {/* «Отменить» рядом с «Отмена» путают — тогда «Не отменять» */}
          <button type="button" className="btn" onClick={() => pending.resolve(false)}>{/^отмен/i.test(pending.ok) ? 'Не отменять' : 'Отмена'}</button>
          <button ref={okRef} type="button" className={pending.danger ? 'btn danger' : 'btn primary'}
            onClick={() => pending.resolve(true)}>{pending.ok}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
