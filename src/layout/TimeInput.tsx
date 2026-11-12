import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { focusNext } from '../lib/advance'
import { useBack } from '../lib/back'
import { parseTime } from '../lib/time'
import { useClosingGuard } from '../lib/unsaved'

import './timeinput.css'

const pad = (n: number) => String(n).padStart(2, '0')
const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h)
/** Без часов работы (`hours`) — обычный день клиники: 07…21. */
const DEFAULT_HOURS = { from: 7, to: 21 }

/** Часы диапазона по порядку смены: 8–19 → 8…19; ночная смена 18–7 (from > to) → 18…23, 0…7. */
function hoursOf({ from, to }: { from: number; to: number }): number[] {
  return from <= to ? ALL_HOURS.filter((h) => h >= from && h <= to) : [...ALL_HOURS.filter((h) => h >= from), ...ALL_HOURS.filter((h) => h <= to)]
}

/** Палец, а не мышь: поле только для чтения (без экранной клавиатуры), выбор — в листе снизу. */
const TOUCH = '(pointer: coarse)'
const isTouch = () => typeof window.matchMedia === 'function' && window.matchMedia(TOUCH).matches

/**
 * Поле времени CRM вместо `<input type="time">`. Системное поле на iPhone открывает колесо, и
 * в Telegram прокрутка колеса вниз закрывала Mini App (свайп «закрыть»). Здесь — панель с чипами,
 * без прокрутки:
 * - сверху крупно выбранное время; есть свободное время врача (`free`) — строка «Свободно»: нажал — готово;
 * - «Час» — только рабочие часы (`hours`, без него 07…21), «Другие часы» — все 24; время вне
 *   рабочих часов — сразу все;
 * - «Минуты» — 00, 15, 30, 45, «Точнее…» — через 5 минут (шаг `step` 15 и больше — только по шагу).
 *
 * Выбор копится в панели: час меняет время только в шапке, нажали минуту — время выбрано и панель
 * закрылась (час, потом минута — два касания). «Готово» на телефоне — применить, если поменяли
 * только час. «✕», потянуть шапку вниз, нажать на фон или Esc — закрыть без изменений.
 * Компьютер: панель под полем, время можно и набрать цифрами («1530», «15:30»). Телефон (палец):
 * поле без клавиатуры, панель — лист снизу. Пока панель открыта, Telegram спросит «закрыть?», если
 * окно всё же потянут вниз (enableClosingConfirmation; старые клиенты — без него).
 *
 * Клавиатура: ↓ в поле — открыть панель; стрелки — по чипам; Enter/пробел — выбрать; Esc — закрыть.
 */
export function TimeInput({ value, onChange, step = 5, min, max, hours, free, disabled, required, name, id, className, ...aria }: {
  /** 'HH:MM' (или 'HH:MM:SS' — секунды не показываем); '' — пусто */
  value: string
  onChange: (value: string) => void
  /** Шаг минут в панели (5 → 00, 15, 30, 45 и «Точнее…» — 00, 05 … 55; 15 → 00, 15, 30, 45). Набрать цифрами можно любую минуту */
  step?: number
  /** 'HH:MM' — раньше выбрать нельзя */
  min?: string
  /** 'HH:MM' — позже выбрать нельзя */
  max?: string
  /**
   * Рабочие часы — их панель показывает сразу, остальные — по «Другие часы». Оба включительно:
   * { from: 8, to: 19 } → 8…19; ночная смена — from > to: { from: 18, to: 7 } → 18…23 и 0…7.
   * Без него — 7…21. Часы врача из /api/slots — `workHours` (lib/time).
   */
  hours?: { from: number; to: number }
  /** Свободные начала 'HH:MM' (например, у врача в этот день) — строка «Свободно» сверху панели */
  free?: string[]
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
  const [minute, setMinute] = useState<string | null>(null)
  const [allHours, setAllHours] = useState(false)
  const [fine, setFine] = useState(false)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const swipeFrom = useRef<number | null>(null)
  const panelId = useId()
  const touch = isTouch()

  const unit = Math.max(step, 5)
  const minutes = Array.from({ length: Math.ceil(60 / unit) }, (_, i) => i * unit).filter((m) => m < 60).map(pad)
  // Основные минуты — четверти часа, остальные — по «Точнее…» (шаг 5). Шаг 15 — только четверти; шаг 10, 20, 30 — все по шагу
  const main = 15 % unit === 0 ? minutes.filter((m) => Number(m) % 15 === 0) : minutes
  const hasFine = main.length < minutes.length
  const allowed = (t: string) => (!min || t >= min.slice(0, 5)) && (!max || t <= max.slice(0, 5))
  const hourAllowed = (h: string) => minutes.some((m) => allowed(`${h}:${m}`))
  const work = hoursOf(hours ?? DEFAULT_HOURS).map(pad)
  const visibleHours = allHours ? ALL_HOURS.map(pad) : work
  const visibleMinutes = fine || !hasFine ? minutes : main
  const freeTimes = (free ?? []).map((t) => t.slice(0, 5)).filter(allowed)
  /** Что применит «Готово»: выбранный час и минута (не подходит к часу — первая доступная). */
  const doneMinute = hour ? (minute && allowed(`${hour}:${minute}`) ? minute : minutes.find((m) => allowed(`${hour}:${m}`)) ?? null) : null

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus && !touch) input.current?.focus()
  }
  useBack(open ? () => close() : null)
  useClosingGuard(open)

  const show = (focusInside = false) => {
    if (disabled || open) return
    const h = shown ? shown.slice(0, 2) : null
    const m = shown ? shown.slice(3, 5) : null
    setHour(h)
    setMinute(m)
    // Время вне рабочих часов (или рабочие все закрыты min/max) — сразу все часы; минута не по четвертям — все минуты
    setAllHours(h != null ? !work.includes(h) : !work.some(hourAllowed))
    setFine(m != null && !main.includes(m))
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
  /** Выбрано время — применить, закрыть и (в форме с data-advance) перейти к следующему полю. */
  const finish = (t: string) => {
    commit(t)
    close()
    focusNext(input.current)
  }
  const pickHour = (h: string) => {
    setHour(h)
    requestAnimationFrame(() => focusChip('.ti-minutes'))
  }
  const pickMinute = (m: string) => {
    if (hour) finish(`${hour}:${m}`)
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

  /** Стрелки по сетке чипов: ←→ — на один, ↑↓ — на ряд (`cols` в ряд). */
  const onGridKey = (cols: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key]
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

  const minuteCols = visibleMinutes.length <= 4 ? visibleMinutes.length : 6
  const panel = (
    <div ref={pop} id={panelId} role="dialog" aria-modal={sheet || undefined} aria-label={aria['aria-label'] ? `${aria['aria-label']}: выбор времени` : 'Выбор времени'}
      className={`ti-pop${sheet ? ' sheet' : ''}${allHours || fine ? ' more' : ''}`} onKeyDown={onPanelKey}
      style={sheet || !place ? undefined : { left: place.left, top: place.top, bottom: place.bottom }}>
      {/* Шапка — как у листа Select: время крупно и «✕» (закрыть без изменений); потянуть вниз — тоже закрыть */}
      <div className="ui-select-head ti-head"
        onTouchStart={sheet ? (e) => { swipeFrom.current = e.touches[0]?.clientY ?? null } : undefined}
        onTouchEnd={sheet ? (e) => {
          const from = swipeFrom.current
          swipeFrom.current = null
          if (from != null && (e.changedTouches[0]?.clientY ?? from) - from > 50) close(false)
        } : undefined}>
        <span className="ti-preview num" aria-live="polite">{hour ?? '––'}:{doneMinute ?? '––'}</span>
        {sheet && <button type="button" className="ui-select-close" aria-label="Закрыть без изменений" onClick={() => close(false)}>✕</button>}
      </div>
      {freeTimes.length > 0 && (
        <>
          <span className="ti-label" id={`${panelId}-f`}>Свободно</span>
          <div className="ti-free" role="group" aria-labelledby={`${panelId}-f`}>
            {freeTimes.map((t) => (
              <button key={t} type="button" className="ti-chip num" aria-pressed={t === shown} onClick={() => finish(t)}>{t}</button>
            ))}
          </div>
        </>
      )}
      <div className="ti-label-row">
        <span className="ti-label" id={`${panelId}-h`}>Час</span>
        {!allHours && <button type="button" className="link ti-more" onClick={() => setAllHours(true)}>Другие часы</button>}
      </div>
      <div className="ti-grid ti-hours" role="group" aria-labelledby={`${panelId}-h`} onKeyDown={onGridKey(6)}>
        {visibleHours.map((h) => (
          <button key={h} type="button" className="ti-chip num" aria-pressed={h === hour} aria-label={`${h} ч`}
            disabled={!hourAllowed(h)} onClick={() => pickHour(h)}>{h}</button>
        ))}
      </div>
      <div className="ti-label-row">
        <span className="ti-label" id={`${panelId}-m`}>{hour ? 'Минуты' : 'Минуты — сначала час'}</span>
        {hasFine && !fine && <button type="button" className="link ti-more" onClick={() => setFine(true)}>Точнее…</button>}
      </div>
      <div className={`ti-grid ti-minutes${minuteCols < 6 ? ' ti-main' : ''}`} style={minuteCols < 6 ? { gridTemplateColumns: `repeat(${minuteCols}, 1fr)` } : undefined}
        role="group" aria-labelledby={`${panelId}-m`} onKeyDown={onGridKey(minuteCols)}>
        {visibleMinutes.map((m) => (
          <button key={m} type="button" className="ti-chip num" aria-pressed={Boolean(hour) && m === minute}
            aria-label={hour ? `${hour}:${m}` : `${m} мин`} disabled={!hour || !allowed(`${hour}:${m}`)}
            onClick={() => pickMinute(m)}>{m}</button>
        ))}
      </div>
      {sheet && (
        <div className="ti-actions">
          <button type="button" className="btn primary" disabled={!hour || !doneMinute} onClick={() => hour && doneMinute && finish(`${hour}:${doneMinute}`)}>Готово</button>
        </div>
      )}
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
