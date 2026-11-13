import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { ExpenseForm } from './ExpenseForm'

type Me = Schemas['BookingViewsMe']

/**
 * «＋ Расход» из «Касса → Деньги»: та же форма, что в «Расходах», окном — записать расход, не уходя из
 * кассы. Компьютер — окно по центру, телефон — лист снизу (как окно подтверждения, layout/Confirm.tsx).
 */
export function ExpenseDialog({ me, doctorId, onClose }: { me: Me; doctorId?: number | null; onClose: () => void }) {
  useBack(onClose)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('input[type="number"]')?.focus()
    return () => back?.focus?.()
  }, [])
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title" className={phone ? 'confirm expense-dialog sheet' : 'confirm expense-dialog'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <div className="block-head">
          <h2 id="expense-dialog-title">Новый расход</h2>
          <button type="button" className="btn ghost small" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
        <ExpenseForm me={me} doctorId={doctorId} onDone={onClose} />
        <p className="hint small">Все расходы и общие расходы клиники с долями врачей — в «Касса» → «Расходы».</p>
      </div>
    </div>,
    document.body,
  )
}
