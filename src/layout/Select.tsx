import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { focusNext } from '../lib/advance'
import { textMatches } from '../lib/search'
import { useBack } from '../lib/back'

/** Пункт списка: как `<option>` — значение, текст, можно выключить; group — подпись `<optgroup>`. */
type Item = { value: string; text: string; disabled: boolean; group?: string }

/** Тот же вид события, что у `<select>`: старые обработчики `(e) => e.target.value` работают как были. */
export type SelectChange = { target: { value: string } }

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/**
 * `<option>` из детей — в том числе из `.map(...)`, условий и фрагментов. `<optgroup label>` —
 * группа с заголовком: её пункты помнят подпись группы.
 */
function itemsOf(children: ReactNode, group?: string): Item[] {
  const out: Item[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>(child)) return
    if (child.type === Fragment) {
      out.push(...itemsOf(child.props.children, group))
      return
    }
    if (child.type === 'optgroup') {
      out.push(...itemsOf(child.props.children, child.props.label ?? ''))
      return
    }
    if (child.type !== 'option') return
    const text = textOf(child.props.children)
    out.push({ value: child.props.value != null ? String(child.props.value) : text, text, disabled: !!child.props.disabled, group })
  })
  return out
}

/** Подряд идущие пункты одной группы — вместе: [подпись, [[пункт, его номер в списке]]]. */
function chunks(shown: Item[]): [string | undefined, [Item, number][]][] {
  const out: [string | undefined, [Item, number][]][] = []
  shown.forEach((item, i) => {
    const last = out[out.length - 1]
    if (last && last[0] === item.group) last[1].push([item, i])
    else out.push([item.group, [[item, i]]])
  })
  return out
}

/** «Анестетик · осталось 5 карп.» → главное и подсказка серым: так длинные пункты читаются легче. */
function split(text: string): [string, string] {
  const i = text.indexOf(' · ')
  return i > 0 ? [text.slice(0, i), text.slice(i + 3)] : [text, '']
}

const PHONE = '(max-width: 640px)'
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches
/** С этого числа пунктов сверху появляется поиск. */
const SEARCH_FROM = 9

/**
 * Свой выпадающий список вместо системного `<select>`: в Telegram и на Android системный — серое
 * окно на весь экран без нашего оформления. Пишется так же, как `<select>` с `<option>` внутри
 * (value / defaultValue / onChange / name / required / disabled), поэтому замена — одно слово.
 * Телефон — лист снизу экрана, компьютер — список под полем; длинный список — с поиском.
 * Клавиатура: ↑ ↓ Enter Esc, как у системного. `<optgroup label>` — группы с заголовками (ARIA
 * role="group"); стрелки идут по пунктам, заголовки пропускают. Поиск — без регистра и «ё/е».
 */
export function Select({ value, defaultValue, onChange, children, name, required, disabled, className, id, collapsible = false, ...aria }: {
  value?: string | number
  defaultValue?: string | number
  onChange?: (e: SelectChange) => void
  children: ReactNode
  name?: string
  required?: boolean
  disabled?: boolean
  className?: string
  id?: string
  /**
   * Группы свёрнуты: сначала только заголовки с числом пунктов, нажали — раскрылась (одна за раз).
   * Для длинных списков вроде услуг клиники. Поиск — по всем пунктам, найденное показано раскрытым.
   */
  collapsible?: boolean
  'aria-label'?: string
}) {
  const items = itemsOf(children)
  const [own, setOwn] = useState(() => String(defaultValue ?? items.find((i) => !i.disabled)?.value ?? ''))
  const current = value != null ? String(value) : own
  const selected = items.find((i) => i.value === current)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [sheet, setSheet] = useState(false)
  const [title, setTitle] = useState('')
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const swipeFrom = useRef<number | null>(null)
  const listId = useId()
  const auto = useId()

  // «Материал со склада…», «Статья…» — подсказка в пустом поле, а не пункт: в списке её нет
  const choices = items.filter((i) => !(i.value === '' && /…$/.test(i.text)) && !(i.disabled && i.value === ''))
  const found = query.trim() ? choices.filter((i) => textMatches(i.text, query) || textMatches(i.group, query)) : choices
  // Свёрнутые группы: без поиска видны пункты без группы и одной раскрытой группы
  const [expanded, setExpanded] = useState<string | null>(null)
  const folding = collapsible && !query.trim() && choices.some((i) => i.group != null)
  const shown = folding ? found.filter((i) => i.group == null || i.group === expanded) : found
  const groupTitles = folding ? [...new Set(choices.map((i) => i.group).filter((g): g is string => g != null))] : []
  const searchable = choices.length >= SEARCH_FROM

  const close = (focus = true) => {
    setOpen(false)
    setQuery('')
    if (focus) button.current?.focus()
  }
  useBack(open ? () => close() : null)

  const show = () => {
    if (disabled) return
    const phone = isPhone()
    setSheet(phone)
    // Заголовок листа: aria-label или текст подписи <label> вокруг поля
    const label = button.current?.labels?.[0]
    const inside = button.current?.textContent ?? ''
    setTitle(aria['aria-label'] ?? (label?.textContent ?? '').replace(inside, '').replace(/\s*\*\s*$/, '').trim())
    // Свёрнутые группы: раскрыта та, где выбранный пункт (если он не в «Часто» — там он тоже есть)
    const startGroup = collapsible ? (choices.filter((i) => i.value === current && i.value !== '').map((i) => i.group).find((g) => g !== 'Часто') ?? null) : null
    setExpanded(startGroup)
    const visible = collapsible ? choices.filter((i) => i.group == null || i.group === startGroup) : choices
    // На телефоне подсветку «под курсором» не ставим: она выглядит как уже выбранный пункт
    const at = visible.findIndex((i) => i.value === current)
    setActive(phone ? at : Math.max(0, at))
    setOpen(true)
  }

  const choose = (item: Item) => {
    if (item.disabled) return
    if (value == null) setOwn(item.value)
    if (item.value !== current) onChange?.({ target: { value: item.value } })
    close()
    // В форме с data-advance — сразу к следующему полю
    focusNext(button.current)
  }

  // Компьютер: список под полем (не влез — над ним); прокрутили страницу — едет за полем
  useLayoutEffect(() => {
    if (!open || sheet) return
    const update = () => {
      const r = button.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 12
      const above = r.top - 12
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16)
      const left = Math.min(r.left, window.innerWidth - width - 8)
      setPlace(below >= 240 || below >= above
        ? { left, width, top: r.bottom + 6, maxHeight: Math.min(below, 420) }
        : { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(above, 420) })
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
      const t = e.target as Node
      if (!list.current?.contains(t) && !button.current?.contains(t)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  })

  // Выбранный пункт — в поле зрения
  useEffect(() => {
    if (!open) return
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const move = (step: number) => {
    if (!shown.length) return
    let i = active
    for (let n = 0; n < shown.length; n++) {
      i = (i + step + shown.length) % shown.length
      if (!shown[i]!.disabled) break
    }
    setActive(i)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = shown[active]
      if (item) choose(item)
    } else if (e.key === 'Escape') {
      // Esc закрывает только список, а не панель, в которой он лежит
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  const [main, hint] = split(selected?.text ?? '')
  const placeholder = !selected || selected.disabled || (selected.value === '' && /…$/.test(selected.text))

  const option = (item: Item, i: number) => {
    const [m, h] = split(item.text)
    return (
      <li key={item.value + i} id={`${auto}-${i}`} data-index={i} data-value={item.value} role="option" aria-selected={item.value === current}
        aria-disabled={item.disabled || undefined} className={i === active ? 'active' : undefined}
        onPointerMove={() => !item.disabled && setActive(i)} onClick={() => choose(item)}>
        <span className="ui-select-text"><span>{m}</span>{h && <span className="hint"><span className="sr-only"> · </span>{h}</span>}</span>
      </li>
    )
  }

  const options = (
    <div ref={list} className={`ui-select-pop${sheet ? ' sheet' : ''}`} onKeyDown={onKey}
      style={sheet || !place ? undefined : { left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}>
      {sheet && (
        // Шапка листа: заголовок и «✕» — на iPhone нажатие на тёмный фон не всегда закрывало лист.
        // Потянуть шапку вниз — тоже закрыть
        <div className="ui-select-head" onTouchStart={(e) => { swipeFrom.current = e.touches[0]?.clientY ?? null }}
          onTouchEnd={(e) => {
            const from = swipeFrom.current
            swipeFrom.current = null
            if (from != null && (e.changedTouches[0]?.clientY ?? from) - from > 50) close(false)
          }}>
          <p className="ui-select-title">{title}</p>
          <button type="button" className="ui-select-close" aria-label="Закрыть" onClick={() => close(false)}>✕</button>
        </div>
      )}
      {searchable && (
        <input type="search" className="ui-select-search" placeholder="Поиск…" aria-label="Поиск в списке" value={query} autoFocus={!sheet}
          aria-controls={listId} aria-activedescendant={shown[active] ? `${auto}-${active}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }} />
      )}
      <ul id={listId} role="listbox" aria-label={aria['aria-label'] ?? (title || undefined)} tabIndex={-1}>
        {folding && shown.filter((i) => i.group == null).map((item) => option(item, shown.indexOf(item)))}
        {folding && groupTitles.map((group) => {
          const isOpen = group === expanded
          const count = choices.filter((i) => i.group === group).length
          return (
            <li key={`f-${group}`} role="none" className={`ui-select-group fold${isOpen ? ' open' : ''}`}>
              <button type="button" className="ui-select-fold" aria-expanded={isOpen}
                onClick={() => { setExpanded(isOpen ? null : group); setActive(-1) }}>
                <span>{group}</span><span className="hint">{count} <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span></span>
              </button>
              {isOpen && (
                <ul role="group" aria-label={group}>
                  {shown.filter((i) => i.group === group).map((item) => option(item, shown.indexOf(item)))}
                </ul>
              )}
            </li>
          )
        })}
        {!folding && chunks(shown).map(([group, rows], g) => group == null ? rows.map(([item, i]) => option(item, i)) : (
          <li key={`g${g}`} role="none" className="ui-select-group">
            <ul role="group" aria-labelledby={`${auto}-g${g}`}>
              <li role="presentation" id={`${auto}-g${g}`} className="ui-select-group-title">{group}</li>
              {rows.map(([item, i]) => option(item, i))}
            </ul>
          </li>
        ))}
        {!folding && !shown.length && <li className="ui-select-empty" aria-disabled="true">Ничего не нашлось</li>}
      </ul>
    </div>
  )

  return (
    <>
      <button ref={button} id={id} type="button" role="combobox" className={`ui-select${className ? ` ${className}` : ''}${placeholder ? ' placeholder' : ''}`}
        aria-label={aria['aria-label']} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown[active] ? `${auto}-${active}` : undefined} disabled={disabled} data-value={current}
        onClick={() => (open ? close() : show())} onKeyDown={onKey}>
        <span className="ui-select-value">{main || '—'}{hint && <span className="hint"> · {hint}</span>}</span>
      </button>
      {(name || required) && (
        // Для форм: значение уходит в FormData, а required не даст отправить пустое — как у <select>
        <input className="ui-select-proxy" tabIndex={-1} aria-hidden="true" name={name} required={required} value={current}
          onChange={() => {}} onFocus={() => button.current?.focus()} />
      )}
      {open && createPortal(
        sheet
          ? <div className="ui-select-backdrop" onClick={(e) => e.target === e.currentTarget && close(false)}>{options}</div>
          : options,
        document.body,
      )}
    </>
  )
}
