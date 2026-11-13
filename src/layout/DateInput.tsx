import { focusNext } from '../lib/advance'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { useSwipeDown } from './useSwipeDown'

/** Как у `<input type="date">`: старые обработчики `(e) => e.target.value` работают как были. */
export type DateChange = { target: { value: string } }
type Locale = 'ru' | 'ky'

const LOCALE: Record<Locale, string> = { ru: 'ru-RU', ky: 'ky-KG' }
const TEXT: Record<Locale, { pick: string; today: string; clear: string; prev: string; next: string; prevYear: string; nextYear: string;
  months: string; years: string; prevYears: string; nextYears: string }> = {
  ru: { pick: 'Выберите дату', today: 'Сегодня', clear: 'Очистить', prev: 'Предыдущий месяц', next: 'Следующий месяц',
    prevYear: 'Предыдущий год', nextYear: 'Следующий год', months: 'Выбрать месяц и год', years: 'Выбрать год',
    prevYears: 'Раньше', nextYears: 'Позже' },
  ky: { pick: 'Күндү тандаңыз', today: 'Бүгүн', clear: 'Тазалоо', prev: 'Мурунку ай', next: 'Кийинки ай',
    prevYear: 'Мурунку жыл', nextYear: 'Кийинки жыл', months: 'Ай жана жылды тандоо', years: 'Жылды тандоо',
    prevYears: 'Мурда', nextYears: 'Кийин' },
}
/** Лет на одной странице выбора года: 4 ряда по 4. */
const YEARS = 16

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const utc = (date: string) => new Date(`${date}T00:00:00Z`)
/** Сегодня по Бишкеку — как во всей CRM (lib/time), без импорта: поле живёт и на сайте. */
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bishkek' }).format(new Date())

/** '2026-11-02' → «2 ноября 2026» (дата без часового пояса — как есть). */
function dateText(date: string, weekday: boolean, locale: Locale): string {
  const d = utc(date)
  if (Number.isNaN(d.getTime())) return date
  return new Intl.DateTimeFormat(LOCALE[locale], { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', weekday: weekday ? 'short' : undefined })
    .format(d).replace(/ г\.?$/, '')
}
const monthTitle = (y: number, m: number, locale: Locale) =>
  new Intl.DateTimeFormat(LOCALE[locale], { timeZone: 'UTC', month: 'long', year: 'numeric', ...(locale === 'ru' ? {} : {}) })
    .format(Date.UTC(y, m, 1)).replace(/ г\.?$/, '').replace(/^./, (c) => c.toUpperCase())
const monthShort = (m: number, locale: Locale) =>
  new Intl.DateTimeFormat(LOCALE[locale], { timeZone: 'UTC', month: 'short' }).format(Date.UTC(2026, m, 1)).replace('.', '')
const weekdays = (locale: Locale) =>
  // 2024-01-01 — понедельник: неделя с понедельника, как в Кыргызстане
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(LOCALE[locale], { timeZone: 'UTC', weekday: 'short' }).format(Date.UTC(2024, 0, 1 + i)))

const PHONE = '(max-width: 640px)'
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches

/**
 * Поле даты в стиле CRM — свой календарь вместо системного (в Telegram и на телефонах системный
 * выглядит по-разному и пугает): компьютер — под полем, телефон — лист снизу. Пишется как
 * `<input type="date">` (value / onChange / min / max / required / name / disabled), поэтому замена
 * не трогает формы. Заголовок месяца — переход к выбору месяца и года (дата рождения в 1980-х —
 * без сотни нажатий). Клавиатура: стрелки по дням, Enter — выбрать, Esc — закрыть.
 */
export function DateInput({ value, onChange, min, max, required, name, disabled, id, className, weekday = false, iconOnly = false,
  placeholder, locale = 'ru', birth = false, ...aria }: {
  value: string
  onChange?: (e: DateChange) => void
  min?: string
  max?: string
  required?: boolean
  name?: string
  disabled?: boolean
  id?: string
  className?: string
  /** «пн, 2 нояб. 2026» — когда важен день недели */
  weekday?: boolean
  /** Только значок календаря: дата уже крупно рядом (заголовок дня в «Расписании») */
  iconOnly?: boolean
  placeholder?: string
  locale?: Locale
  /**
   * Дата рождения: пустое поле открывается сразу на выборе года (около 1990), дальше месяц и
   * день — без листания десятилетий; «Сегодня» не нужна.
   */
  birth?: boolean
  'aria-label'?: string
}) {
  const t = TEXT[locale]
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days')
  const base = value || (birth ? '1990-01-01' : max && today() > max ? max : min && today() < min ? min : today())
  const [view, setView] = useState({ y: utc(base).getUTCFullYear(), m: utc(base).getUTCMonth() })
  const [focus, setFocus] = useState(base)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const dialogId = useId()

  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max)
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }
  useBack(open ? () => close() : null)
  // Телефон: лист с календарём — потянуть вниз, закрыть
  useSwipeDown(pop, open && sheet ? () => close(false) : null)

  const show = () => {
    if (disabled) return
    const start = value || base
    setView({ y: utc(start).getUTCFullYear(), m: utc(start).getUTCMonth() })
    setFocus(start)
    setMode(birth && !value ? 'years' : 'days')
    setSheet(isPhone())
    setOpen(true)
  }
  const pick = (d: string) => {
    if (!allowed(d)) return
    if (d !== value) onChange?.({ target: { value: d } })
    close()
    // В форме с data-advance — сразу к следующему полю
    focusNext(button.current)
  }

  // Компьютер: под полем (не влезает — над ним); прокрутили — едет за полем
  useLayoutEffect(() => {
    if (!open || sheet) return
    const update = () => {
      const r = button.current?.getBoundingClientRect()
      if (!r) return
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 320 - 8))
      const below = window.innerHeight - r.bottom - 12
      setPlace(below >= 360 || below >= r.top ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, sheet])

  // Нажали мимо — закрыть
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      const target = e.target as Node
      if (!pop.current?.contains(target) && !button.current?.contains(target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  })

  // Клавиатурный фокус — на выбранный день; в выборе года и месяца — на выбранный (или первый) пункт
  useEffect(() => {
    if (!open) return
    if (mode === 'days') pop.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus()
    else (pop.current?.querySelector<HTMLButtonElement>('.date-month[aria-pressed=true]') ?? pop.current?.querySelector<HTMLButtonElement>('.date-month'))?.focus()
  }, [open, mode, focus])

  const shiftMonth = (by: number) => setView(({ y, m }) => {
    const d = new Date(Date.UTC(y, m + by, 1))
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
  })
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (mode !== 'days') return
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) {
      e.preventDefault()
      const d = utc(focus)
      d.setUTCDate(d.getUTCDate() + step)
      const next = d.toISOString().slice(0, 10)
      setFocus(next)
      setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
    }
  }

  // Сетка месяца: с понедельника, пустые клетки до 1-го числа
  const first = new Date(Date.UTC(view.y, view.m, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
  const now = today()
  const label = aria['aria-label']
  // Страница лет, на которой текущий год просмотра — в третьем ряду (видно и раньше, и позже)
  const yearFrom = view.y - 9

  const calendar = (
    <div ref={pop} id={dialogId} role="dialog" aria-modal={sheet || undefined} aria-label={label ?? t.pick}
      className={`date-pop${sheet ? ' sheet' : ''}`} onKeyDown={onKey}
      style={sheet || !place ? undefined : { left: place.left, top: place.top, bottom: place.bottom }}>
      {mode === 'days' ? (
        <>
          <div className="date-pop-head">
            <button type="button" className="date-nav" aria-label={t.prev} onClick={() => shiftMonth(-1)}>‹</button>
            <button type="button" className="date-title" aria-label={`${monthTitle(view.y, view.m, locale)} — ${t.months}`}
              onClick={() => setMode('months')}>{monthTitle(view.y, view.m, locale)} <span aria-hidden="true">▾</span></button>
            <button type="button" className="date-nav" aria-label={t.next} onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div className="date-grid" role="grid">
            {weekdays(locale).map((w) => <span key={w} className="date-wd" aria-hidden="true">{w}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = iso(view.y, view.m, i + 1)
              const ok = allowed(d)
              return (
                <button key={d} type="button" data-date={d} tabIndex={d === focus ? 0 : -1} disabled={!ok}
                  aria-label={dateText(d, true, locale)} aria-pressed={d === value}
                  className={['date-day', d === value ? 'chosen' : '', d === now ? 'today' : ''].filter(Boolean).join(' ')}
                  onClick={() => pick(d)}>{i + 1}</button>
              )
            })}
          </div>
          <div className="date-pop-foot">
            {allowed(now) && !birth && <button type="button" className="link" onClick={() => pick(now)}>{t.today}</button>}
            {!required && value && <button type="button" className="link" onClick={() => { onChange?.({ target: { value: '' } }); close() }}>{t.clear}</button>}
          </div>
        </>
      ) : mode === 'years' ? (
        <>
          <div className="date-pop-head">
            <button type="button" className="date-nav" aria-label={t.prevYears} onClick={() => setView((v) => ({ ...v, y: v.y - YEARS }))}>‹</button>
            <span className="date-title static">{yearFrom}–{yearFrom + YEARS - 1}</span>
            <button type="button" className="date-nav" aria-label={t.nextYears} onClick={() => setView((v) => ({ ...v, y: v.y + YEARS }))}>›</button>
          </div>
          <div className="date-months date-years">
            {Array.from({ length: YEARS }, (_, i) => yearFrom + i).map((y) => (
              <button key={y} type="button" aria-pressed={!!value && y === utc(value).getUTCFullYear()} className="date-month"
                disabled={(min != null && y < Number(min.slice(0, 4))) || (max != null && y > Number(max.slice(0, 4)))}
                onClick={() => { setView((v) => ({ ...v, y })); setMode('months') }}>{y}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="date-pop-head">
            <button type="button" className="date-nav" aria-label={t.prevYear} onClick={() => setView((v) => ({ ...v, y: v.y - 1 }))}>‹</button>
            <button type="button" className="date-title" aria-label={`${view.y} — ${t.years}`} onClick={() => setMode('years')}>
              {view.y} <span aria-hidden="true">▾</span></button>
            <button type="button" className="date-nav" aria-label={t.nextYear} onClick={() => setView((v) => ({ ...v, y: v.y + 1 }))}>›</button>
          </div>
          <div className="date-months">
            {Array.from({ length: 12 }, (_, m) => (
              <button key={m} type="button" aria-pressed={m === view.m} className="date-month"
                onClick={() => { setView((v) => ({ ...v, m })); setMode('days') }}>{monthShort(m, locale)}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  return (
    <>
      <button ref={button} id={id} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? dialogId : undefined} data-value={value}
        aria-label={label ?? (iconOnly ? t.pick : undefined)} title={iconOnly ? t.pick : undefined}
        className={['date-input', iconOnly ? 'icon-only' : '', value ? '' : 'empty', className].filter(Boolean).join(' ')}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (open && e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          } else if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            show()
          }
        }}>
        <svg className="date-ico" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v4M13 2.5v4" /></svg>
        {!iconOnly && <span className={value ? 'date-text' : 'date-text hint'}>{value ? dateText(value, weekday, locale) : placeholder ?? t.pick}</span>}
      </button>
      {(name || required) && (
        // Для форм: значение уходит в FormData, а required не даст отправить пустое — как у <input>
        <input className="ui-select-proxy" tabIndex={-1} aria-hidden="true" name={name} required={required} value={value}
          onChange={() => {}} onFocus={() => button.current?.focus()} />
      )}
      {open && createPortal(
        sheet ? <div className="ui-select-backdrop" onClick={(e) => e.target === e.currentTarget && close(false)}>{calendar}</div> : calendar,
        document.body,
      )}
    </>
  )
}
