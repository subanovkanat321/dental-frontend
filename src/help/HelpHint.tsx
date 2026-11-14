import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { openMine } from '../lib/route'
import { HINTS, type HintKey } from './hints'

/**
 * Кнопка «?» рядом с заголовком экрана: по нажатию — коротко, что здесь делают, и «Подробнее в
 * руководстве» (нужный раздел книги «Помощь → Руководство», прямо в Tish). Закрывается повторным
 * нажатием, Esc или нажатием мимо. Сама не открывается никогда.
 *
 * Свой текст (`title` + `children`) — вместо длинного абзаца-пояснения над таблицей: он прятался бы в
 * «?», а не занимал 2–3 строки над содержимым. Без ссылки на руководство.
 */
export function HelpHint({ hint, title, children }: { hint?: HintKey; title?: string; children?: ReactNode }) {
  const h = hint ? HINTS[hint] : { title: title ?? 'Подсказка', text: children, anchor: null }
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
          {/* Раздел книги «Помощь → Руководство» прямо в Tish (#/help/guide/<якорь>); «‹ Назад» вернёт на этот экран */}
          {h.anchor && <a href={`#/help/guide/${h.anchor}`} onClick={(e) => { e.preventDefault(); setOpen(false); openMine('help', `guide/${h.anchor}`) }}>Подробнее в руководстве</a>}
        </span>
      )}
    </span>
  )
}
