import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { Page } from '../lib/route'
import { useSectionActive } from '../lib/section'
import { subHref } from '../lib/sub'
import { matches, useMedia } from '../lib/useMedia'
import { countOf, LOUD, type Sub } from './nav'
import { NavContext, type NavApi } from './useSection'

/** Подсказку «здесь переключаются разделы» показали и закрыли (или про вкладки рассказал тур — tour/Tour.tsx) — только флаг, без данных. */
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
 * Заголовок раздела с подразделами. Подразделы — панелью вкладок над страницей (`SubTabs`, порталом
 * в место от Shell — вне шапки страницы, чтобы панель прилипала при прокрутке всей страницы), и на
 * телефоне, и на компьютере (с 2026-11-11). `h1` подраздела остаётся для читалок экрана, но не
 * виден: подраздел подсвечен во вкладках, раздел — в меню. Без подразделов (или один) — обычный
 * заголовок; вне Shell (тесты страниц) — мелко «Раздел», крупно подраздел.
 */
export function SectionTitle({ page, title, subTitle, hint }: { page: Page; title: string; subTitle?: string | null; hint?: ReactNode }) {
  const nav = useContext(NavContext)
  // Разделы, где уже были, остаются на странице скрытыми (App): вкладки — только у видимого
  const visible = useSectionActive()
  if (!subTitle) return <div className="with-hint"><h1>{title}</h1>{hint}</div>
  if (nav && nav.subs(page).length > 1) {
    return (
      <>
        <h1 className="sr-only sect-h1">{subTitle}</h1>
        {visible && nav.tabsSlot && createPortal(<SubTabs nav={nav} page={page} title={title} hint={hint} />, nav.tabsSlot)}
      </>
    )
  }
  return (
    <div className="with-hint sect-title">
      <div className="sect-titles"><span className="sect-crumb">{title}</span><h1>{subTitle}</h1></div>
      {hint}
    </div>
  )
}

/**
 * Где была полоска и прокрутка вкладок раздела. Платформа и Клиника рисуют шапку заново в каждом
 * подразделе — без этого вкладки при переключении прыгали бы в начало, а полоска не переезжала.
 */
const lastPos = new Map<Page, { ink: Ink; scroll: number; active: string | null }>()
type Ink = { left: number; width: number }
type Edges = { start: boolean; end: boolean; more: boolean; newRight: 0 | 1 | 2 }
const NO_EDGES: Edges = { start: false, end: false, more: false, newRight: 0 }
/** Полоска под текстом, а не под всей кнопкой: от края кнопки до текста — её отступ */
const INK_INSET = 12

/**
 * Подразделы — привычной панелью вкладок (как папки Telegram, YouTube), на телефоне и на компьютере: все подразделы
 * в строку во всю ширину, открытый — цветом акцента с полоской снизу, полоска переезжает при
 * переключении. Не влезли — строка листается вбок (с привязкой к вкладке), у краёв со скрытыми
 * вкладками — затухание, справа — «⌄»: на телефоне лист со всеми подразделами (тот же, что долгим
 * нажатием на раздел внизу), на компьютере — список под кнопкой. Новое во вкладках, скрытых справа, —
 * точкой на «⌄». «?» — в конце строки: раздела или подраздела (`SubHelp`), не оба. Телефон, первый раз — пузырь-подсказка под панелью.
 *
 * Ссылки с `aria-current`, а не `role=tab`: каждая — свой адрес (#/раздел/подраздел), «назад»
 * браузера возвращает в прежний подраздел.
 */
function SubTabs({ nav, page, title, hint }: { nav: NavApi; page: Page; title: string; hint?: ReactNode }) {
  const subs = nav.subs(page)
  const active = nav.active(page)
  const bar = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const helpBox = useRef<HTMLSpanElement>(null)
  const [ink, setInk] = useState<Ink | null>(() => lastPos.get(page)?.ink ?? null)
  const [edges, setEdges] = useState<Edges>(NO_EDGES)
  const [stuck, setStuck] = useState(false)
  const phone = useMedia('(max-width: 760px)')
  // Подсказка «здесь переключаются разделы» — только телефону: на компьютере вкладки и так на виду
  const [tip, setTip] = useState(() => phone && !hintSeen())
  // Компьютер: «⌄» — список всех подразделов под кнопкой (на телефоне — лист снизу от Shell)
  const [menu, setMenu] = useState(false)
  const moreBox = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  // Место «?» подраздела: отдаём его Shell (nav.helpSlot) и следим, положил ли туда подраздел свой «?»
  const [slotEl, setSlotEl] = useState<HTMLSpanElement | null>(null)
  const { setHelpSlot: giveSlot } = nav
  const setHelpSlot = useCallback((el: HTMLSpanElement | null) => {
    setSlotEl(el)
    giveSlot(el)
  }, [giveSlot])
  const [subHelp, setSubHelp] = useState(false)
  useLayoutEffect(() => {
    if (!slotEl) return
    const check = () => setSubHelp(slotEl.childElementCount > 0)
    check()
    const observer = new MutationObserver(check)
    observer.observe(slotEl, { childList: true })
    return () => observer.disconnect()
  }, [slotEl])

  const activeTab = useCallback(() => list.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? null, [])

  /** Края, «⌄» и полоска — из размеров. «⌄» нужна, если вкладки не влезают в строку без неё:
   *  ширина содержимого не зависит от того, видна ли кнопка, — показ кнопки не «дёргает» сам себя. */
  const measure = useCallback(() => {
    const el = scroller.current
    const row = list.current
    const box = bar.current
    if (!el || !row || !box) return
    const room = box.clientWidth - (helpBox.current?.offsetWidth ?? 0)
    const more = row.offsetWidth > room + 1
    const right = el.scrollLeft + el.clientWidth
    let newRight: 0 | 1 | 2 = 0
    for (const a of row.querySelectorAll<HTMLElement>('[data-count]')) {
      // Больше половины вкладки за правым краем — её число не видно
      if (a.offsetLeft + a.offsetWidth / 2 > right) newRight = Math.max(newRight, a.dataset.count === 'loud' ? 2 : 1) as 0 | 1 | 2
    }
    const next: Edges = { start: el.scrollLeft > 1, end: right < el.scrollWidth - 1, more, newRight }
    setEdges((p) => (p.start === next.start && p.end === next.end && p.more === next.more && p.newRight === next.newRight ? p : next))
    const tab = activeTab()
    if (tab) {
      const nextInk = { left: tab.offsetLeft + INK_INSET, width: Math.max(0, tab.offsetWidth - 2 * INK_INSET) }
      setInk((p) => (p && p.left === nextInk.left && p.width === nextInk.width ? p : nextInk))
      lastPos.set(page, { ink: nextInk, scroll: el.scrollLeft, active })
    }
  }, [activeTab, page, active])

  /** Открытая вкладка — по центру строки (только вбок: страница по вертикали не двигается, поэтому
   *  не scrollIntoView). */
  const center = useCallback((smooth: boolean) => {
    const el = scroller.current
    const tab = activeTab()
    if (!el || !tab) return
    const left = Math.max(0, tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2)
    const behavior = smooth && !matches('(prefers-reduced-motion: reduce)') ? 'smooth' : 'auto'
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior })
    else el.scrollLeft = left
  }, [activeTab])
  /** Человек сам листал вкладки — не возвращать их к открытой при пересчёте размеров */
  const touched = useRef(false)

  // Открыли раздел или сменили подраздел: открытая вкладка — в поле зрения, полоска переезжает
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const saved = lastPos.get(page)
    if (!mounted.current && saved) el.scrollLeft = saved.scroll
    // Переключили подраздел, пролистав страницу вниз (панель прилипла) — новый подраздел с начала
    if (saved && saved.active !== active && window.scrollY > 0) window.scrollTo(0, 0)
    touched.current = false
    center(mounted.current || saved != null)
    mounted.current = true
    measure()
  }, [active, page, center, measure])

  // Пришёл или ушёл «?» подраздела — место под вкладки другое (без ResizeObserver — тоже)
  useLayoutEffect(() => {
    measure()
  }, [subHelp, measure])

  // Появилась «⌄» — строка стала уже: открытая вкладка (например, последняя) могла уйти под неё
  useLayoutEffect(() => {
    if (!touched.current) center(false)
  }, [edges.more, center])

  // Повернули телефон, догрузился шрифт, появилось число — пересчитать и, если сами не листали, снова к открытой
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // Только если размеры правда поменялись: первый вызов наблюдателя сразу после открытия не должен
    // обрывать плавный переезд к открытой вкладке
    // «?» подраздела приходит порталом после первого замера — его ширина тоже меняет, нужна ли «⌄»
    const sizeNow = () => `${bar.current?.clientWidth}:${list.current?.offsetWidth}:${helpBox.current?.offsetWidth}`
    let size = sizeNow()
    const onResize = () => {
      const now = sizeNow()
      if (now === size) return
      size = now
      measure()
      if (!touched.current) center(false)
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
    if (bar.current) observer?.observe(bar.current)
    if (list.current) observer?.observe(list.current)
    if (helpBox.current) observer?.observe(helpBox.current)
    window.addEventListener('resize', onResize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [measure, center])

  // Страницу прокрутили — панель прилипла к верху: лёгкая тень под ней
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const closeTip = () => {
    if (!tip) return
    markHintSeen()
    setTip(false)
  }
  const open = () => {
    closeTip()
    if (phone) nav.openSheet(page)
    else setMenu((v) => !v)
  }
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => { if (!moreBox.current?.contains(e.target as Node)) setMenu(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])
  const pick = (key: string) => {
    setMenu(false)
    if (key !== active) nav.go(page, key)
  }
  const others = subs.filter((s) => s.key !== active)
  return (
    <nav ref={bar} className="sub-tabs" data-tour="sub-tabs" aria-label={`Подразделы: ${title}`} data-stuck={stuck || undefined}>
      <div ref={scroller} className="sub-tabs-scroll" onScroll={measure}
        onPointerDown={() => { touched.current = true }} onWheel={() => { touched.current = true }}
        data-fade-start={edges.start || undefined} data-fade-end={edges.end || undefined}>
        <div ref={list} className="sub-tabs-list">
          {subs.map((s) => {
            const on = s.key === active
            const n = countOf(nav.counts, page, s.key)
            const loud = LOUD.has(`${page}/${s.key}`)
            return (
              <a key={s.key} className={on ? 'sub-tab active' : 'sub-tab'} href={subHref(page, s.key)} aria-current={on ? 'page' : undefined}
                aria-label={n ? `${s.title} · ${n}` : undefined} data-count={n > 0 ? (loud ? 'loud' : 'quiet') : undefined}
                onClick={(e) => { e.preventDefault(); closeTip(); if (!on) nav.go(page, s.key) }}>
                {s.title}
                {n > 0 && <span className={loud ? 'nav-count' : 'nav-count quiet'} aria-hidden="true">{n}</span>}
              </a>
            )
          })}
          {ink && <span className="sub-tabs-ink" aria-hidden="true" style={{ left: ink.left, width: ink.width }} />}
        </div>
      </div>
      {/* «?» в конце строки: раздела — или подраздела (SubHelp кладёт его в sub-help порталом). Оба сразу
          не показываем — два одинаковых кружка подряд не различить: остаётся «?» подраздела, он про то, что
          на экране; общее про раздел — в «Помощь → Руководство» */}
      <span ref={helpBox} className="sub-tabs-helps">
        {hint && !subHelp && <span className="sub-tabs-help">{hint}</span>}
        <span ref={setHelpSlot} className="sub-tabs-help sub-help" />
      </span>
      {edges.more && (
        <div ref={moreBox} className="sub-tabs-more-box">
          <button type="button" className="sub-tabs-more" aria-haspopup={phone ? 'dialog' : 'true'} aria-expanded={phone ? undefined : menu} onClick={open}
            aria-label={`Все подразделы: ${title}${edges.newRight ? ' (есть новое)' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            {edges.newRight > 0 && <span className={edges.newRight === 2 ? 'sub-tabs-dot' : 'sub-tabs-dot quiet'} aria-hidden="true" />}
          </button>
          {menu && !phone && (
            <div className="sub-tabs-menu" role="group" aria-label={`Все подразделы: ${title}`}>
              {subs.map((s) => {
                const on = s.key === active
                const n = countOf(nav.counts, page, s.key)
                return (
                  <a key={s.key} className={on ? 'nav-subitem active' : 'nav-subitem'} href={subHref(page, s.key)} aria-current={on ? 'page' : undefined}
                    aria-label={n ? `${s.title} · ${n}` : undefined} onClick={(e) => { e.preventDefault(); pick(s.key) }}>
                    <span className="nav-sub-title">{s.title}</span>
                    {n > 0 && <span className={LOUD.has(`${page}/${s.key}`) ? 'nav-count' : 'nav-count quiet'} aria-hidden="true">{n}</span>}
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}
      {tip && (
        <div className="sect-tip" role="note" onClick={closeTip}>
          <span>Здесь переключаются разделы: {tipNames(nav, page, others)}{edges.more ? ' Листайте вбок или нажмите ⌄ — весь список.' : ''}</span>
          <button type="button" className="sect-tip-close" aria-label="Закрыть подсказку" onClick={(e) => { e.stopPropagation(); closeTip() }}>✕</button>
        </div>
      )}
    </nav>
  )
}

/** Два подраздела для подсказки: сперва те, где бывает новое (лист ожидания, вопросы). */
function tipNames(nav: NavApi, page: Page, others: Sub[]): string {
  const counted = (s: Sub) => (`${page}/${s.key}` in nav.counts ? 0 : 1)
  const names = [...others].sort((a, b) => counted(a) - counted(b)).slice(0, 2).map((s) => s.title)
  return `${names.join(', ')}${others.length > 2 ? '…' : '.'}`
}
