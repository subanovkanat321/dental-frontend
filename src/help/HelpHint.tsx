import { useEffect, useId, useRef, useState } from 'react'

import { HINTS, type HintKey } from './hints'

/**
 * Кнопка «?» рядом с заголовком экрана: по нажатию — коротко, что здесь делают, и «Подробнее в
 * руководстве» (открывается новой вкладкой, from=app — «Вернуться в Tish»). Закрывается повторным
 * нажатием, Esc или нажатием мимо. Сама не открывается никогда.
 */
export function HelpHint({ hint }: { hint: HintKey }) {
  const h = HINTS[hint]
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])
  return (
    <span className="help-hint" ref={box}>
      <button type="button" className="help-hint-btn" aria-label={`Подсказка: ${h.title}`} aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((v) => !v)}>?</button>
      {open && (
        <span className="help-hint-pop" id={id} role="note" aria-label={`Подсказка: ${h.title}`}>
          <span>{h.text}</span>
          <a href={`/guide?from=app#${h.anchor}`} target="_blank" rel="noopener noreferrer">Подробнее в руководстве</a>
        </span>
      )}
    </span>
  )
}
