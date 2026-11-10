import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import type { Page } from '../lib/route'
import { subHref } from '../lib/sub'
import { useMedia } from '../lib/useMedia'
import { countOf, LOUD, sumOf, type Sub } from './nav'
import { NavContext, type NavApi } from './useSection'

/** Таблетки под строкой — только у коротких списков: у Кассы (8) и Платформы (14) хватит листа. */
export const PILLS_MAX = 5

/** Подсказку «здесь переключаются разделы» показали и закрыли — только флаг, без данных. */
export const SUB_HINT_KEY = 'crm.subSwitchHint'

function hintSeen(): boolean {
  try {
    return localStorage.getItem(SUB_HINT_KEY) === 'seen'
  } catch {
    return true // приватный режим — не надоедать
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(SUB_HINT_KEY, 'seen')
  } catch {
    // приватный режим
  }
}

/**
 * Заголовок раздела с подразделами. Компьютер: мелко «Раздел», крупно — подраздел (подразделы — в
 * меню слева). Телефон: строка-переключатель во всю ширину (`SubSwitch`). Без подразделов — просто
 * заголовок раздела.
 */
export function SectionTitle({ page, title, subTitle, hint }: { page: Page; title: string; subTitle?: string | null; hint?: ReactNode }) {
  const nav = useContext(NavContext)
  const phone = useMedia('(max-width: 760px)')
  if (!subTitle) return <div className="with-hint"><h1>{title}</h1>{hint}</div>
  if (phone && nav) return <SubSwitch nav={nav} page={page} title={title} subTitle={subTitle} hint={hint} />
  return (
    <div className="with-hint sect-title">
      <div className="sect-titles"><span className="sect-crumb">{title}</span><h1>{subTitle}</h1></div>
      {hint}
    </div>
  )
}

/**
 * Телефон: подразделы — заметным переключателем, а не текстом заголовка (владелец: «вкладки сверху
 * легко не заметить»). Строка на мягком фоне акцента, высотой с палец: мелко раздел, крупно
 * подраздел, справа — число нового в других подразделах (как у свёрнутого раздела в меню) и
 * пилюля «Разделы · 5 ⌄». Нажимается вся строка — лист снизу. У коротких списков (≤ 5) под ней
 * таблетки: видны сразу, нажал — переключился. Первый раз — пузырь-подсказка у строки.
 *
 * Заголовок `h1` — подраздел, как на компьютере; кнопка растянута на всю строку поверх (`::after`),
 * поэтому внутри кнопки нет заголовка, а у «?» свой слой выше.
 */
function SubSwitch({ nav, page, title, subTitle, hint }: { nav: NavApi; page: Page; title: string; subTitle: string; hint?: ReactNode }) {
  const subs = nav.subs(page)
  const active = nav.active(page)
  const others = subs.filter((s) => s.key !== active)
  const { total, loud } = sumOf(nav.counts, page, others)
  const pills = subs.length > 1 && subs.length <= PILLS_MAX
  const [tip, setTip] = useState(() => subs.length > 1 && !hintSeen())
  const closeTip = () => {
    markHintSeen()
    setTip(false)
  }
  const open = () => {
    if (tip) closeTip()
    nav.openSheet(page)
  }
  const label = `Подразделы: ${title} · ${subTitle}${total > 0 ? `; новое в других — ${total}` : ''}`
  return (
    <div className="sect-phone">
      <div className="sect-bar">
        <div className="sect-titles"><span className="sect-crumb">{title}</span><h1>{subTitle}</h1></div>
        {hint && <span className="sect-bar-hint">{hint}</span>}
        <button type="button" className="sect-open" aria-haspopup="dialog" aria-label={label} onClick={open}>
          {total > 0 && <span className={loud ? 'nav-count' : 'nav-count quiet'} aria-hidden="true">{total}</span>}
          <span className="sect-pill" aria-hidden="true">
            Разделы · {subs.length}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </button>
      </div>
      {pills && <SubPills nav={nav} page={page} title={title} subs={subs} active={active} onPick={tip ? closeTip : undefined} />}
      {tip && (
        <div className="sect-tip" role="note" onClick={closeTip}>
          <span>Здесь переключаются разделы: {tipNames(nav, page, others)}</span>
          <button type="button" className="sect-tip-close" aria-label="Закрыть подсказку" onClick={(e) => { e.stopPropagation(); closeTip() }}>✕</button>
        </div>
      )}
    </div>
  )
}

/** Два подраздела для подсказки: сперва те, где бывает новое (лист ожидания, вопросы). */
function tipNames(nav: NavApi, page: Page, others: Sub[]): string {
  const counted = (s: Sub) => (`${page}/${s.key}` in nav.counts ? 0 : 1)
  const names = [...others].sort((a, b) => counted(a) - counted(b)).slice(0, 2).map((s) => s.title)
  return `${names.join(', ')}${others.length > 2 ? '…' : ''}`
}

/** Таблетки подразделов: прокрутка вбок, открытый — выделен и виден (прокручен в поле зрения). */
function SubPills({ nav, page, title, subs, active, onPick }: {
  nav: NavApi; page: Page; title: string; subs: Sub[]; active: string | null; onPick?: () => void
}) {
  const row = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (el && row.current && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <nav ref={row} className="sect-pills" aria-label={`Подразделы раздела «${title}»`}>
      {subs.map((s) => {
        const on = s.key === active
        const n = countOf(nav.counts, page, s.key)
        return (
          <a key={s.key} className={on ? 'sect-chip active' : 'sect-chip'} href={subHref(page, s.key)} aria-current={on ? 'page' : undefined}
            aria-label={n ? `${s.title} · ${n}` : undefined}
            onClick={(e) => { e.preventDefault(); onPick?.(); if (!on) nav.go(page, s.key) }}>
            {s.title}
            {n > 0 && <span className={LOUD.has(`${page}/${s.key}`) ? 'nav-count' : 'nav-count quiet'} aria-hidden="true">{n}</span>}
          </a>
        )
      })}
    </nav>
  )
}
