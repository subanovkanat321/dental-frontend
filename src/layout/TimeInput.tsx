import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { focusNext } from '../lib/advance'
import { useBack } from '../lib/back'
import { parseTime } from '../lib/time'
import { useClosingGuard } from '../lib/unsaved'

import './timeinput.css'

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h))

/** Палец, а не мышь: поле только для чтения (без экранной клавиатуры), выбор — в листе снизу. */
const TOUCH = '(pointer: coarse)'
const isTouch = () => typeof window.matchMedia === 'function' && window.matchMedia(TOUCH).matches

/**
 * Поле времени CRM вместо `<input type="time">`. Системное поле на iPhone открывает колесо, и
 * в Telegram прокрутка колеса вниз закрывала Mini App (свайп «закрыть»). Здесь — панель с
 * чипами: 24 часа по 6 в ряд, под ними минуты с шагом `step`; нажал час, потом минуту — готово,
 * без прокрутки. Компьютер: панель под полем, время можно и набрать цифрами («1530», «15:30»).
 * Телефон (палец): поле без клавиатуры, панель — лист снизу. Пока панель открыта, Telegram
 * спросит «закрыть?», если окно всё же потянут вниз (enableClosingConfirmation; старые клиенты — без него).
 *
 * Клавиатура: ↓ в поле — открыть панель; стрелки — по чипам; Enter/пробел — выбрать; Esc — закрыть.
 */
export function TimeInput({ value, onChange, step = 5, min, max, disabled, required, name, id, className, ...aria }: {
  /** 'HH:MM' (или 'HH:MM:SS' — секунды не показываем); '' — пусто */
  value: string
  onChange: (value: string) => void
  /** Шаг минут в панели (5 → 00, 05 … 55; 15 → 00, 15, 30, 45). Набрать цифрами можно любую минуту */
  step?: number
  /** 'HH:MM' — раньше выбрать нельзя */
  min?: string
  /** 'HH:MM' — позже выбрать нельзя */
  max?: string
  disabled?: boolean
  required?: boolean
  name?: string
  id?: string
  className?: string
  'aria-label'?: string
}) {
  const shown = value.slice(0, 5)
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [hour, setHour] = useState<string | null>(null)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const touch = isTouch()

  const minutes = Array.from({ length: Math.ceil(60 / Math.max(step, 5)) }, (_, i) => pad(i * Math.max(step, 5))).filter((m) => Number(m) < 60)
  const allowed = (t: string) => (!min || t >= min.slice(0, 5)) && (!max || t <= max.slice(0, 5))
  const hourAllowed = (h: string) => minutes.some((m) => allowed(`${h}:${m}`))

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus && !touch) input.current?.focus()
  }
  useBack(open ? () => close() : null)
  useClosingGuard(open)

  const show = (focusInside = false) => {
    if (disabled || open) return
    setHour(shown ? shown.slice(0, 2) : null)
    setSheet(touch)
    setOpen(true)
    if (focusInside || touch) requestAnimationFrame(() => focusChip('.ti-hours'))
  }
  const focusChip = (grid: string) => {
    const box = pop.current?.querySelector(grid)
    ;(box?.querySelector<HTMLButtonElement>('[aria-pressed=true]:not(:disabled)') ?? box?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
  }
  const commit = (t: string) => {
    setDraft(null)
    if (t !== shown) onChange(t)
  }
  const pickHour = (h: string) => {
    setHour(h)
    requestAnimationFrame(() => focusChip('.ti-minutes'))
  }
  const pickMinute = (m: string) => {
    if (!hour) return
    commit(`${hour}:${m}`)
    close()
    focusNext(input.current)
  }

  // Компьютер: под полем (не влезает — над ним), едет за полем при прокрутке
  useLayoutEffect(() => {
    if (!open || sheet) return
    const update = () => {
      const r = input.current?.getBoundingClientRect()
      if (!r) return
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 300 - 8))
      const below = window.innerHeight - r.bottom - 12
      setPlace(below >= 300 || below >= r.top ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, sheet])

  // Нажали мимо поля и панели — закрыть
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      const target = e.target as Node
      if (!pop.current?.contains(target) && !input.current?.parentElement?.contains(target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  })

  /** Стрелки по сетке чипов: ←→ — на один, ↑↓ — на ряд (6 в ряд). */
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[e.key]
    if (!by) return
    const chips = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const at = chips.indexOf(document.activeElement as HTMLButtonElement)
    const next = chips[at + by]
    if (at < 0 || !next) return
    e.preventDefault()
    next.focus()
  }
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  const minutesFor = hour ?? shown.slice(0, 2)
  const panel = (
    <div ref={pop} id={panelId} role="dialog" aria-modal={sheet || undefined} aria-label={aria['aria-label'] ? `${aria['aria-label']}: выбор времени` : 'Выбор времени'}
      className={`ti-pop${sheet ? ' sheet' : ''}`} onKeyDown={onPanelKey}
      style={sheet || !place ? undefined : { left: place.left, top: place.top, bottom: place.bottom }}>
      <div className="ti-head">
        <span className="ti-preview num" aria-live="polite">{hour ?? '––'}:{hour && shown.slice(0, 2) === hour ? shown.slice(3, 5) : '––'}</span>
        {sheet && <button type="button" className="link" onClick={() => close()}>Закрыть</button>}
      </div>
      <span className="ti-label" id={`${panelId}-h`}>Час</span>
      <div className="ti-grid ti-hours" role="group" aria-labelledby={`${panelId}-h`} onKeyDown={onGridKey}>
        {HOURS.map((h) => (
          <button key={h} type="button" className="ti-chip num" aria-pressed={h === hour} aria-label={`${h} ч`}
            disabled={!hourAllowed(h)} onClick={() => pickHour(h)}>{h}</button>
        ))}
      </div>
      <span className="ti-label" id={`${panelId}-m`}>{hour ? 'Минуты' : 'Минуты — сначала час'}</span>
      <div className="ti-grid ti-minutes" role="group" aria-labelledby={`${panelId}-m`} onKeyDown={onGridKey}>
        {minutes.map((m) => (
          <button key={m} type="button" className="ti-chip num" aria-pressed={Boolean(hour) && `${hour}:${m}` === shown}
            aria-label={hour ? `${hour}:${m}` : `${m} мин`} disabled={!hour || !allowed(`${minutesFor}:${m}`)}
            onClick={() => pickMinute(m)}>{m}</button>
        ))}
      </div>
    </div>
  )

  return (
    <span className={['time-input', disabled ? 'disabled' : '', className].filter(Boolean).join(' ')}>
      <svg className="ti-ico" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="7.2" /><path d="M10 6v4.2l2.8 1.8" /></svg>
      <input ref={input} id={id} name={name} type="text" inputMode="numeric" autoComplete="off" placeholder="чч:мм" maxLength={5}
        className="num" value={draft ?? shown} required={required} disabled={disabled} readOnly={touch}
        aria-label={aria['aria-label']} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => show()}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          if (text === '') onChange('')
          else {
            const t = parseTime(text)
            if (t) onChange(t)
          }
        }}
        onBlur={() => {
          // Ушли с недописанным — показываем последнее верное значение
          if (draft != null) {
            const t = parseTime(draft)
            if (t) commit(t)
            setDraft(null)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            close()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (open) focusChip('.ti-hours')
            else show(true)
          }
        }} />
      {open && createPortal(
        sheet ? <div className="ui-select-backdrop" onClick={(e) => e.target === e.currentTarget && close(false)}>{panel}</div> : panel,
        document.body,
      )}
    </span>
  )
}
