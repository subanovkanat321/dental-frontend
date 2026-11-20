import { Fragment, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

import type { Page } from '../lib/route'
import { subHref } from '../lib/sub'
import { countOf, isLoud, type Counts, type Sub } from './nav'
import { NavCount } from './NavCount'
import { Icon } from './Icon'
import { SubIcon } from './subIcons'

/**
 * Лист подразделов (телефон, с 2026-11-20): открывается нажатием на раздел в нижнем меню (Пациенты, Касса, Склад)
 * и на заголовок «Склад · Материалы ▾» над страницей. Владелец: вкладки сверху обрезались посреди слова, было
 * непонятно, что там, — лучше сразу при выборе раздела предложить его подразделы.
 *
 * Лист стоит над нижним меню и меню не закрывает: нажатие на тот же раздел ещё раз закрывает лист, на другой —
 * показывает его подразделы. Первая строка — последний открытый подраздел (lib/sub помнит его и после
 * перезапуска), подсвечена: частый путь — одно лишнее нажатие. Дальше остальные по порядку, с иконкой, короткой
 * подсказкой и числами (как в меню). Появляется сразу, без анимации: им пользуются десятки раз в день.
 *
 * Доступность: role=menu, пункты — ссылки role=menuitem (у каждого свой адрес); открыли — фокус на первую строку,
 * ↑/↓ — по строкам, Esc закрывает, фокус возвращается на кнопку, с которой открыли. «Назад» (телефон, Telegram),
 * свайп вниз и нажатие мимо — закрывают (Shell: useBack, useSwipeDown).
 */
export function NavSheet({ section, subs, active, remembered, current, counts, loud, card, onPick, onClose }: {
  section: { key: Page; title: string }
  subs: Sub[]
  /** Открытый (или последний открытый) подраздел — первой строкой */
  active: string | null
  /** Подраздел запомнен (открывали раньше), а не просто первый по порядку */
  remembered: boolean
  /** Человек уже в этом разделе */
  current: boolean
  counts: Counts
  loud?: ReadonlySet<string>
  /** Карточка листа — для свайпа вниз */
  card: RefObject<HTMLDivElement | null>
  onPick: (sub: string) => void
  onClose: () => void
}) {
  const opener = useRef<HTMLElement | null>(null)
  // Открыли или переключили раздел — запомнить кнопку, с которой открыли (Esc и выбор вернут на неё фокус), и
  // фокус на первую строку (с клавиатуры сразу Enter — последний подраздел)
  useEffect(() => {
    const at = document.activeElement
    if (at instanceof HTMLElement && !card.current?.contains(at)) opener.current = at
    card.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [section.key, card])
  useEffect(() => () => {
    const back = opener.current
    if (back?.isConnected) back.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const first = subs.find((s) => s.key === active) ?? subs[0]
  const rest = subs.filter((s) => s !== first)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(card.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }
  const row = (s: Sub, top: boolean) => {
    const n = countOf(counts, section.key, s.key)
    const mark = top ? (current ? 'открыт сейчас' : remembered ? 'в прошлый раз' : null) : null
    return (
      <a key={s.key} role="menuitem" className={top ? 'nav-sheet-item first' : 'nav-sheet-item'} href={subHref(section.key, s.key)}
        aria-current={top && current ? 'page' : undefined}
        aria-label={[s.title, n ? String(n) : null, mark].filter(Boolean).join(' · ')}
        onClick={(e) => { e.preventDefault(); onPick(s.key) }}>
        <SubIcon page={section.key} sub={s.key} />
        <span className="nav-sheet-text">
          <span className="nav-sheet-title">{s.title}</span>
          {(mark || s.hint) && <span className="nav-sheet-hint">{mark ? `${mark[0]!.toUpperCase()}${mark.slice(1)}` : s.hint}</span>}
        </span>
        <NavCount n={n} loud={isLoud(loud, section.key, s.key)} />
        {top && <span className="nav-sheet-check" aria-hidden="true">✓</span>}
      </a>
    )
  }
  return (
    <div className="more-sheet nav-sheet" onClick={onClose}>
      <div ref={card} className="more-card nav-sheet-card" role="menu" data-nav-sheet="" aria-label={`Подразделы: ${section.title}`}
        onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="sub-sheet-head" role="presentation">
          <span className="sub-bar-ico" style={{ color: `var(--ico-${section.key})` }}><Icon name={section.key} /></span><h2>{section.title}</h2>
          <button type="button" className="sub-sheet-close" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
        {first && row(first, true)}
        {rest.map((s, i) => (
          <Fragment key={s.key}>
            {s.group && s.group !== rest[i - 1]?.group && <p className="nav-group" role="presentation">{s.group}</p>}
            {row(s, false)}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
