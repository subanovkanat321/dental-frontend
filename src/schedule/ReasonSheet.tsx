import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { useSwipeDown } from '../layout/useSwipeDown'
import { CANCEL_CHOICES, NO_SHOW_CHOICES, REASON_TEXT, type CancelReason } from './cancelReasons'

/**
 * «Отменён» и «Неявка» в пилюле статуса — вместо простого вопроса: та же форма окна (компьютер — по центру,
 * телефон — лист снизу, свайп вниз — «Не отменять»), но с причинами (V235). Причину можно не выбирать — тогда
 * как раньше, просто отмена; «Другое» открывает поле «пара слов».
 */
export function ReasonSheet({ kind, question, ok, onPick, onClose }: {
  kind: 'CANCELLED' | 'NO_SHOW'
  question: string
  /** надпись кнопки: «Отменить запись», «Отметить неявку», «Отклонить заявку» */
  ok: string
  onPick: (reason: CancelReason | null, note: string | null) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState<CancelReason | null>(null)
  const [note, setNote] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
  useBack(onClose)
  useSwipeDown(box, phone ? onClose : null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    okRef.current?.focus()
    return () => back?.focus?.()
  }, [])
  const choices = kind === 'CANCELLED' ? CANCEL_CHOICES : NO_SHOW_CHOICES
  const label = kind === 'CANCELLED' ? 'Причина отмены' : 'Причина неявки'
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} className={phone ? 'confirm sheet reason-sheet' : 'confirm reason-sheet'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <p>{question}</p>
        <div className="reason-list" role="radiogroup" aria-label={label}>
          {choices.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={reason === c} className="reason-chip"
              onClick={() => setReason(reason === c ? null : c)}>{REASON_TEXT[c]}</button>
          ))}
        </div>
        {reason === 'OTHER' && (
          <label className="field">
            <span>Пара слов (необязательно)</span>
            <input value={note} maxLength={200} autoFocus aria-label="Причина — пара слов" placeholder="например, уехал в другой город"
              onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>{kind === 'CANCELLED' ? 'Не отменять' : 'Отмена'}</button>
          <button ref={okRef} type="button" className="btn danger"
            onClick={() => onPick(reason, reason === 'OTHER' && note.trim() ? note.trim() : null)}>{ok}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
