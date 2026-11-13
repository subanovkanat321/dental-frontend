import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { useSwipeDown } from './useSwipeDown'
import { pending as current, subscribe } from '../lib/confirm'

/** Окно подтверждения для `ask` (lib/confirm): компьютер — по центру, телефон — лист снизу. */
export function ConfirmHost() {
  const pending = useSyncExternalStore(subscribe, current)
  const okRef = useRef<HTMLButtonElement>(null)
  // «Назад» телефона при открытом вопросе — как «Отмена»
  useBack(pending ? () => pending.resolve(false) : null)
  useEffect(() => {
    if (!pending) return
    const back = document.activeElement as HTMLElement | null
    okRef.current?.focus()
    return () => back?.focus?.()
  }, [pending])
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  const box = useRef<HTMLDivElement>(null)
  // Телефон: лист снизу — потянуть вниз, как «Отмена»
  useSwipeDown(box, pending && phone ? () => pending.resolve(false) : null)
  if (!pending) return null
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && pending.resolve(false)}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-label="Подтверждение" aria-describedby="confirm-text"
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
          {!pending.single && <button type="button" className="btn" onClick={() => pending.resolve(false)}>{/^отмен/i.test(pending.ok) ? 'Не отменять' : 'Отмена'}</button>}
          <button ref={okRef} type="button" className={pending.danger ? 'btn danger' : 'btn primary'}
            onClick={() => pending.resolve(true)}>{pending.ok}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
