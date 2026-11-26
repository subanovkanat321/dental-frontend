import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { initials } from '../lib/avatars'
import { useBack } from '../lib/back'
import './doctorFilter.css'

/** Пункт списка: врач (или любой «чей» выбор) — ключ, имя, фото или цвет кружка, мелкая строка под именем. */
export type DoctorOption<K extends number | string = number> = {
  id: K
  name: string
  photoUrl?: string
  /** Цвет кружка с инициалами — как у врача в «Расписании» (lib/avatars.ts colorOf) */
  color: string
  /** Под именем серым: «2 работы в лаборатории», «5 записей сегодня» */
  sub?: string
  /** Справа от имени: чип «🆕 2» */
  badge?: ReactNode
}

function Avatar({ option }: { option: Pick<DoctorOption<number | string>, 'name' | 'photoUrl' | 'color'> }) {
  return option.photoUrl
    ? <img className="pick-avatar" src={option.photoUrl} alt="" />
    : <span className="pick-avatar" style={{ background: option.color }} aria-hidden="true">{initials(option.name.replace(/ \(я\)$/, ''))}</span>
}

/** «Все врачи» (или «Вся клиника») — последним пунктом, с кружком 👥. */
export type AllOption = { label?: string; sub?: string; icon?: string; buttonLabel?: string; buttonName?: string }

/**
 * Выбор врача кнопкой с цветным кружком (как «Чьё расписание»): нажали — список врачей карточками: фото или инициалы
 * цветом врача, имя, мелкая строка (сколько записей, работ…), ✓ у выбранного; «Все врачи» с 👥 — последним
 * (`all={false}` — пункта нет: врачу без права смотреть всех). Свой список вместо системного: у системного только текст.
 *
 * `card` — крупная карточка во всю ширину (телефон, «Расписание»); `pill` — таблетка в строке фильтров
 * (шапки «Пациентов», «Склада», «Кассы»). Список — под кнопкой; на телефоне не вылезает за экран.
 * Клавиатура: Enter и пробел — выбрать, ↑ ↓ — по пунктам, Esc и «Назад» — закрыть.
 */
export function DoctorFilter<K extends number | string>({
  label, options, value, onChange, all = {}, variant = 'pill', buttonSub, side, footer, className, buttonLabel, readOnly = false,
}: {
  /** Что выбираем: «Врач», «Чьи пациенты», «Чья касса» — подпись списка и начало подписи кнопки */
  label: string
  options: DoctorOption<K>[]
  /** null — «Все врачи» */
  value: K | null
  onChange: (value: K | null) => void
  all?: AllOption | false
  variant?: 'card' | 'pill'
  /** Мелкая строка в самой кнопке: у `card` — под именем, у `pill` — рядом */
  buttonSub?: string
  /** Рядом с кнопкой (📅 у «Расписания»); close — закрыть список */
  side?: (close: () => void) => ReactNode
  /** Под списком («Врачи в расписании…») */
  footer?: (close: () => void) => ReactNode
  className?: string
  /** Своя подпись кнопки для чтения с экрана (по умолчанию «label: имя») */
  buttonLabel?: string
  /** Выбирать не из чего (один врач): тот же вид, но без ▾ и списка — просто чьё это */
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const close = () => setOpen(false)
  useBack(open ? close : null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  // Таблетка справа в строке (телефон): список шире кнопки — сдвигаем влево, чтобы не вылез за край экрана
  useLayoutEffect(() => {
    const el = list.current
    if (!open || !el || variant !== 'pill') return
    el.style.left = ''
    const rect = el.getBoundingClientRect()
    const over = rect.right - (window.innerWidth - 8)
    if (over > 0) el.style.left = `${-Math.min(over, rect.left - 8)}px`
  }, [open, variant])

  const current = options.find((o) => o.id === value)
  const allOpt = all === false ? null : all
  const allLabel = allOpt?.label ?? 'Все врачи'
  const allIcon = allOpt?.icon ?? '👥'
  const pick = (next: K | null) => {
    onChange(next)
    setOpen(false)
  }
  const onKey = (e: KeyboardEvent<HTMLLIElement>, next: K | null) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(next)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const sibling = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
      ;(sibling as HTMLElement | null)?.focus()
    }
  }
  const name = current ? current.name : allOpt?.buttonName ?? allLabel

  return (
    <div ref={root} className={['doctor-picker', variant === 'pill' ? 'doctor-filter' : null, className].filter(Boolean).join(' ')}>
      <div className="pick-row">
        {readOnly ? (
          <div className="pick-current readonly" role="note" aria-label={buttonLabel ?? `${label}: ${current ? current.name : ''}`}>
            {current && <Avatar option={current} />}
            <span className="pick-text">
              <strong>{name}</strong>
              {buttonSub && <span className="hint">{buttonSub}</span>}
            </span>
          </div>
        ) : (
        <button type="button" className="pick-current" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
          aria-label={buttonLabel ?? `${label}: ${current ? current.name : allOpt?.buttonLabel ?? allLabel}`}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            // ↓ на закрытой кнопке — открыть и встать на выбранный пункт
            if (e.key !== 'ArrowDown') return
            e.preventDefault()
            setOpen(true)
            requestAnimationFrame(() => (list.current?.querySelector('[aria-selected=true]') as HTMLElement | null)?.focus())
          }}>
          {current ? <Avatar option={current} /> : <span className="pick-avatar all" aria-hidden="true">{allIcon}</span>}
          <span className="pick-text">
            <strong>{name}</strong>
            {buttonSub && <span className="hint">{buttonSub}</span>}
          </span>
          <span className="pick-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        )}
        {side?.(close)}
      </div>
      {open && (
        <div ref={list} className="pick-list">
          <ul role="listbox" id={listId} aria-label={label}>
            {options.map((o) => (
              <li key={o.id} role="option" aria-selected={value === o.id} onClick={() => pick(o.id)} onKeyDown={(e) => onKey(e, o.id)} tabIndex={0}>
                <Avatar option={o} />
                <span className="pick-text">
                  <strong>{o.name}</strong>
                  {o.sub && <span className="hint">{o.sub}</span>}
                </span>
                {o.badge}
                <span className="pick-check" aria-hidden="true">{value === o.id ? '✓' : ''}</span>
              </li>
            ))}
            {allOpt && (
              <li className="pick-all" role="option" aria-selected={value == null} onClick={() => pick(null)} onKeyDown={(e) => onKey(e, null)} tabIndex={0}>
                <span className="pick-avatar all" aria-hidden="true">{allIcon}</span>
                <span className="pick-text">
                  <strong>{allLabel}</strong>
                  {allOpt.sub && <span className="hint">{allOpt.sub}</span>}
                </span>
                <span className="pick-check" aria-hidden="true">{value == null ? '✓' : ''}</span>
              </li>
            )}
          </ul>
          {footer?.(close)}
        </div>
      )}
    </div>
  )
}
