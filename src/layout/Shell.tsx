import { Fragment, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { closeHelpChat, openHelpChat, useHelpChat } from '../lib/helpChat'
import type { Page } from '../lib/route'
import { openSub, subHref, useSub } from '../lib/sub'
import { matches, useMedia } from '../lib/useMedia'
import { useWaitlist } from '../api/settings'
import { CLINIC_ALIAS, SETTINGS_ALIAS } from '../settings/items'
import { countOf, currentSub, LOUD, subsOf, sumOf, type Counts, type Sub } from './nav'
import { NavContext, type NavApi } from './useSection'
import { AdminNotices } from './AdminNotices'
import { OfflineNotice } from './OfflineNotice'
import { ProfileNotice } from './ProfileNotice'
import { Icon } from './Icon'
import { SubIcon } from './subIcons'
import { Avatar, HelpMenuItems, MeMenuItems, MenuPanel } from './MeMenu'
import { whoAmI } from './me'
import { useFitPanels } from './fitPanels'
import { useSwipeDown } from './useSwipeDown'
import { useNavGap } from './navGap'
import { isAssistant } from '../lib/roles'
import { SurveyInvite } from '../survey/SurveyInvite'
import { useNewQuestions } from '../api/questions'
import { TourHost } from '../tour/Tour'
import { PushPrompt } from '../pwa/PushPrompt'
import { useFullView } from '../lib/fullView'
import { confirmLeave } from '../lib/unsaved'

type Me = Schemas['BookingViewsMe']

// Чат «Помощь» — отдельным кусочком: грузится, только когда его открыли
const HelpChatPanel = lazy(() => import('../account/HelpChat').then((m) => ({ default: m.HelpChatPanel })))

/**
 * «Помощь». Компьютер — пункт внизу меню (плавающая кнопка в углу закрывала последнюю строку таблиц):
 * открывает меню — первым чат с помощником Tish, затем руководство, техподдержка, отзыв,
 * конфиденциальность, Instagram. Телефон — маленькая круглая кнопка над нижним меню на главных экранах
 * клиники (сразу чат; под неё у страницы запас снизу) и пункт «Помощь» в «Ещё» — то же меню листом.
 */
const HELP_PAGES: Page[] = ['schedule', 'patients', 'cash', 'stock']

/** Разделы клиники — сотрудникам; «Платформа» — команде Tish (владелец и менеджеры). */
const CLINIC_SECTIONS = [
  { key: 'schedule', title: 'Расписание' },
  { key: 'patients', title: 'Пациенты' },
  // 3D-атлас и презентации — показать пациенту на консультации; всем сотрудникам клиники
  { key: 'learn', title: 'Для пациента' },
  { key: 'cash', title: 'Касса' },
  { key: 'stock', title: 'Склад' },
  // О клинике, персонал, услуги, рабочее время, кресла (с 2026-11-10 — раздел, до того группа «Настроек»)
  { key: 'clinic', title: 'Клиника' },
  { key: 'settings', title: 'Настройки' },
] as const
const PLATFORM = { key: 'platform', title: 'Платформа' } as const

function sectionsOf(me: Me): readonly { key: Page; title: string }[] {
  // Ассистенту — без «Кассы»: денег он не видит. Раздел без единого пункта по правам роли не показываем
  // (страховка: сейчас «Памятки» и «Откуда приходят пациенты» в «Настройках» видны всем ролям)
  const clinic = CLINIC_SECTIONS.filter((s) => !(s.key === 'cash' && isAssistant(me))
    && !((s.key === 'settings' || s.key === 'clinic') && subsOf(s.key, me).length === 0))
  return [...(me.doctor ? clinic : []), ...(me.platform ? [PLATFORM] : [])]
}

/**
 * Телефон сотрудника клиники: внизу расписание, пациенты, касса, склад и «Ещё» — в нём свой аватар
 * (лист «Я»), «Клиника», «Для пациента», «Настройки», «Платформа» и «Помощь».
 */
const PHONE_MAIN: readonly Page[] = ['schedule', 'patients', 'cash', 'stock']

/** На телефоне внизу помещается 4 раздела и «Ещё»: остальное — в выезжающем меню. */
const MOBILE_MAIN = 4

/** Долгое нажатие на кнопку раздела внизу (телефон) — лист подразделов. */
const LONG_PRESS_MS = 500

/** Окно уже́ — меню по умолчанию свёрнуто (ноутбуки 1280–1366; сначала — что выбрал человек). */
const NARROW_BY_DEFAULT = '(min-width: 761px) and (max-width: 1366px)'

/**
 * Раскладка CRM: меню слева деревом — разделы (по ролям), под открытым разделом его подразделы
 * (бывшие вкладки сверху: «Пациенты → Лист ожидания», «Касса → Зарплата», пункты «Настроек» по
 * группам). Стрелка › у другого раздела раскрывает его подразделы, не уводя с экрана. Свёрнутое
 * меню — полоса иконок: подразделы всплывают панелью при наведении (на сенсорном экране — по нажатию).
 * У свёрнутого раздела — сумма чисел его подразделов.
 *
 * Внизу меню — «Помощь» и блок «Я» (аватар, имя, роль): по нажатию меню — профиль, оформление,
 * уведомления, календарь, установить приложение, «Выйти» (DESIGN.md → Layout).
 *
 * Телефон: меню — полоса внизу (расписание, пациенты, касса, склад и «Ещё» — остальные разделы, свой
 * аватар и «Помощь»). Подразделы — панелью вкладок вверху (layout/section.tsx, место — `tabsSlot`),
 * весь список — листом снизу: из «⌄» в конце панели или долгим нажатием на кнопку раздела внизу. «Я» и «Помощь» — тоже листом.
 */
export function Shell({ me, page, onNavigate, children }: { me: Me; page: Page; onNavigate: (page: Page) => void; children: ReactNode }) {
  const clinic = me.doctor ? me.clinic?.brandName || me.clinic?.name || 'Клиника' : 'Команда Tish'
  const role = !me.doctor ? (me.owner ? 'владелец платформы' : 'менеджер платформы')
    : me.admin ? 'руководитель' : me.reception ? 'регистратура' : isAssistant(me) ? 'ассистент' : 'врач'
  const sections = useMemo(() => sectionsOf(me), [me])
  // Числа у подразделов: вопросы пациентов ждут ответа, сколько в листе ожидания (видно из любого раздела)
  const questions = useNewQuestions(Boolean(me.doctor)).data?.count ?? 0
  const waitlist = useWaitlist(Boolean(me.doctor)).data?.length ?? 0
  const counts: Counts = { 'patients/questions': questions, 'patients/waitlist': waitlist }
  // Открытый подраздел каждого раздела (адрес или последний открытый) и пункт «Настроек»
  const chosen: Partial<Record<Page, string | null>> = {
    patients: useSub('patients'), cash: useSub('cash'), stock: useSub('stock'), clinic: useSub('clinic'), platform: useSub('platform'),
    settings: useSub('settings'),
  }
  const subsBy = useMemo(() => Object.fromEntries(sections.map((s) => [s.key, subsOf(s.key, me)])) as Record<Page, Sub[]>, [sections, me])
  // Скрытые пункты «Клиники» и «Настроек» (#/clinic/shifts, #/settings/promo) подсвечивают свой основной пункт
  const ALIAS: Partial<Record<Page, Record<string, string>>> = { clinic: CLINIC_ALIAS, settings: SETTINGS_ALIAS }
  const activeSub = (key: Page): string | null => {
    const sub = chosen[key]
    return currentSub(subsBy[key] ?? [], sub ? ALIAS[key]?.[sub] ?? sub : sub)
  }
  // Телефон: внизу четыре раздела и «Ещё» (в нём остальные разделы, свой аватар и «Помощь»)
  const extra = me.doctor ? sections.filter((x) => !PHONE_MAIN.includes(x.key)) : sections.slice(MOBILE_MAIN)
  const [more, setMore] = useState(false)
  // Меню блока «Я» и «Помощи» (компьютер — карточка у кнопки, телефон — лист)
  const [menu, setMenu] = useState<'me' | 'help' | null>(null)
  const meButton = useRef<HTMLButtonElement>(null)
  const helpButton = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // «Ещё» снизу — тоже слой: «назад» телефона закрывает его, а не уводит из раздела
  useBack(more ? () => setMore(false) : null)
  // Лист подразделов (телефон): «назад» закрывает его
  const [sheet, setSheet] = useState<Page | null>(null)
  useBack(sheet ? () => setSheet(null) : null)
  // Листы «Ещё» и подразделов — потянуть вниз, закрыть (как остальные нижние листы)
  const moreCard = useRef<HTMLDivElement>(null)
  const subCard = useRef<HTMLDivElement>(null)
  useSwipeDown(moreCard, more ? () => setMore(false) : null)
  useSwipeDown(subCard, sheet ? () => setSheet(null) : null)
  // Место панели вкладок подразделов (телефон): раздел кладёт её туда порталом
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null)
  // Место «?» подраздела в панели вкладок: панель отдаёт его (ref), подраздел кладёт туда «?» (SubHelp)
  const [helpSlot, setHelpSlot] = useState<HTMLElement | null>(null)
  // Чат «Спросить помощника»: null — закрыт; открывают меню, круглая кнопка и страницы «Помощи» (lib/helpChat.ts)
  const help = useHelpChat()
  const phone = useMedia('(max-width: 760px)')
  // Компьютер: меню можно свернуть до полосы иконок — расписанию больше места (выбор запоминается).
  // Кнопка — у логотипа, на одном месте в обоих видах; клавиша «[». Ноутбук до 1366px, пока ни разу не
  // выбирали, — свёрнуто: 220px меню там — шестая часть экрана, а расписанию нужна ширина
  const [narrow, toggleNarrow] = useFullView('sidebar-narrow', () => matches(NARROW_BY_DEFAULT))
  // Подсказка у иконки свёрнутого меню (раздел без подразделов, «Помощь», «Я», кнопка меню)
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null)
  // Стрелкой › можно раскрыть любой раздел (и открытый — быстрый переход в подраздел другого раздела без
  // ухода с экрана). Не запоминаем: перешли в другой раздел — снова всё свёрнуто (кроме «Настроек»)
  const [toggled, setToggled] = useState<Partial<Record<Page, boolean>>>({})
  const [toggledFor, setToggledFor] = useState(page)
  if (toggledFor !== page) {
    setToggledFor(page)
    setToggled({})
  }
  // С 2026-11-11 подразделы открытого раздела — вкладками над страницей (layout/section.tsx), поэтому в
  // дереве он сам не раскрыт: меню короче и не дублирует вкладки. «Настройки» — так же (с 2026-11-13 — тоже
  // вкладками; раскрытые 10 пунктов выталкивали «Помощь» и «Я» за низ экрана 1366×768). Стрелка › раскрывает
  // любой раздел; наведение мышью — панель подразделов справа (и у развёрнутого меню, с 2026-11-13)
  const expanded = (key: Page) => toggled[key] ?? false
  // Панель подразделов у раздела под мышью (свёрнутое меню — и нажатого пальцем)
  const [fly, setFly] = useState<{ key: Page; top: number; left: number } | null>(null)
  const flyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Раздел, с которого панель открыли клавишей «→» (Esc вернёт на него фокус)
  const flyFrom = useRef<HTMLElement | null>(null)
  const pointer = useRef<string>('mouse')
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pressed = useRef(false)
  // Панель справа — целиком в окне, прокрутка внутри неё (layout/fitPanels.ts)
  const workspace = useRef<HTMLElement>(null)
  useFitPanels(workspace)
  // Телефон: нижнее меню — у настоящего низа экрана, последний блок страницы докручивается выше него (iPhone, layout/navGap.ts)
  const sidebar = useRef<HTMLElement>(null)
  useNavGap(sidebar, phone)
  useEffect(() => () => { clearTimeout(flyTimer.current); clearTimeout(pressTimer.current) }, [])
  // Панель по нажатию закрывается нажатием мимо неё и Esc
  useEffect(() => {
    if (!fly) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.nav-item, .nav-fly')) setFly(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setFly(null)
      // Открыли с клавиатуры — фокус обратно на раздел
      if (flyFrom.current && document.activeElement?.closest('.nav-fly')) flyFrom.current.focus()
      flyFrom.current = null
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [fly])
  // Открыли «→» — фокус на первый пункт панели (она в body, Tab до неё от меню не дойдёт)
  useEffect(() => {
    if (fly && flyFrom.current) document.querySelector<HTMLElement>('.nav-fly a')?.focus()
  }, [fly])
  const toggleMenu = useCallback(() => {
    setFly(null)
    setTip(null)
    setMenu(null)
    toggleNarrow()
  }, [toggleNarrow])
  // «[» — свернуть/развернуть меню (как в Linear). Не мешает вводу: в поле, списке, редакторе — это просто
  // символ; с Ctrl/Alt/⌘ — чужие сочетания (браузера, раскладки)
  useEffect(() => {
    if (phone) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"], [role="listbox"]'))) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      toggleMenu()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phone, toggleMenu])
  /** Свёрнутое меню: подсказка справа от иконки при наведении и фокусе с клавиатуры (подписи спрятаны). */
  const tipOn = (text: string) => narrow ? {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(text, e.currentTarget),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) showTip(text, e.currentTarget) },
    onBlur: () => setTip(null),
  } : {}
  const showTip = (text: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setTip({ text, top: r.top + r.height / 2, left: r.right + 8 })
  }
  const go = (key: Page) => {
    setMore(false)
    setTip(null)
    setMenu(null)
    setFly(null)
    onNavigate(key)
  }
  const goSub = (key: Page, sub: string) => {
    // Пункты «Клиники» и «Настроек» — формы: из пункта с несохранёнными правками сначала спросим
    if ((key === 'clinic' || key === 'settings') && key === page && !confirmLeave()) return
    setMore(false)
    setFly(null)
    setSheet(null)
    openSub(key, sub)
  }
  const showFly = (key: Page, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setFly({ key, top: r.top, left: r.right + 6 })
  }
  /** Панель подразделов по наведению: у свёрнутого меню — всегда, у развёрнутого (с 2026-11-13) — на компьютере
   *  с мышью, если раздел не раскрыт стрелкой › (тогда подразделы и так списком под ним). */
  const canFly = (key: Page) => Boolean(subsBy[key]?.length) && !phone
    && (narrow || (!expanded(key) && matches('(hover: hover) and (pointer: fine)')))
  const enter = (key: Page, el: HTMLElement) => {
    if (!canFly(key) || pointer.current === 'touch') return
    clearTimeout(flyTimer.current)
    // Развёрнутое меню: подольше ждём — мышь часто просто проходит по меню к странице, панель не должна мигать
    flyFrom.current = null
    flyTimer.current = setTimeout(() => showFly(key, el), fly ? 0 : narrow ? 120 : 150)
  }
  const leave = () => {
    if (pointer.current === 'touch') return
    clearTimeout(flyTimer.current)
    flyTimer.current = setTimeout(() => setFly(null), narrow ? 200 : 250)
  }
  /** Клавиатура: «→» на разделе — его подразделы панелью, фокус на первый пункт; Esc — закрыть, фокус назад. */
  const flyKey = (key: Page, e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' || !subsBy[key]?.length || phone || (!narrow && expanded(key))) return
    e.preventDefault()
    const button = e.currentTarget
    clearTimeout(flyTimer.current)
    flyFrom.current = button
    showFly(key, button.closest('.nav-item') as HTMLElement)
  }
  // Телефон: долгое нажатие на раздел с подразделами — лист; отпустили раньше — обычный переход
  const pressStart = (key: Page, e: React.PointerEvent) => {
    pointer.current = e.pointerType
    pressed.current = false
    clearTimeout(pressTimer.current)
    if (!matches('(max-width: 760px)') || !subsBy[key]?.length) return
    pressTimer.current = setTimeout(() => {
      pressed.current = true
      setSheet(key)
    }, LONG_PRESS_MS)
  }
  const pressEnd = () => clearTimeout(pressTimer.current)
  const clickSection = (key: Page, e: React.MouseEvent<HTMLButtonElement>) => {
    if (pressed.current) {
      // Долгое нажатие уже открыло лист — «щелчок» после него не переход
      pressed.current = false
      return
    }
    // Свёрнутое меню и палец (сенсорный ноутбук): наведения нет — нажатие показывает подразделы
    if (narrow && pointer.current === 'touch' && subsBy[key]?.length && !matches('(max-width: 760px)')) {
      const el = e.currentTarget.closest('.nav-item') as HTMLElement
      clearTimeout(flyTimer.current)
      if (fly?.key === key) setFly(null)
      else showFly(key, el)
      return
    }
    go(key)
  }
  const subLinks = (key: Page, className: string) => {
    const active = key === page ? activeSub(key) : null
    let group: string | undefined
    return (subsBy[key] ?? []).map((s) => {
      const n = countOf(counts, key, s.key)
      const head = s.group && s.group !== group ? <p key={`g:${s.group}`} className="nav-group">{s.group}</p> : null
      group = s.group
      const on = s.key === active
      return (
        <Fragment key={s.key}>
          {head}
          <a className={on ? `${className} active` : className} href={subHref(key, s.key)} aria-current={on ? 'page' : undefined}
            aria-label={n ? `${s.title} · ${n}` : undefined}
            onClick={(e) => { e.preventDefault(); goSub(key, s.key) }}>
            <SubIcon page={key} sub={s.key} />
            <span className="nav-sub-title">{s.title}</span>
            {n > 0 && <span className={LOUD.has(`${key}/${s.key}`) ? 'nav-count' : 'nav-count quiet'} aria-hidden="true">{n}</span>}
            {className === 'sheet-item' && on && <span className="sheet-check" aria-hidden="true">✓</span>}
          </a>
        </Fragment>
      )
    })
  }
  const nav: NavApi = { openSheet: setSheet, subs: (key) => subsBy[key] ?? [], active: activeSub, go: goSub, counts, tabsSlot, helpSlot, setHelpSlot }
  const sheetSection = sheet ? sections.find((s) => s.key === sheet) : undefined
  const { name } = whoAmI(me)
  const meHead = <><Avatar me={me} size="lg" /><p className="menu-who"><strong>{name}</strong><span className="hint">{role} · {clinic}</span></p></>
  const openMenu = (which: 'me' | 'help') => {
    setMore(false)
    setFly(null)
    setMenu((m) => (m === which ? null : which))
  }
  return (
    <div className={narrow ? 'shell narrow' : 'shell'}>
      <aside ref={sidebar} className="sidebar">
        <div className="brand-row">
          {/* Свернуть/развернуть — первой в меню, у логотипа: на одном месте в обоих видах (как ≡ у Gmail) */}
          {!phone && (
            <button type="button" className="sidebar-toggle" aria-expanded={!narrow} aria-label={narrow ? 'Развернуть меню' : 'Свернуть меню'}
              aria-keyshortcuts="[" onClick={toggleMenu} {...tipOn('Развернуть меню · [')} title={narrow ? undefined : 'Свернуть меню · ['}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" />
                <path d={narrow ? 'M13.5 10l2 2-2 2' : 'M16 10l-2 2 2 2'} />
              </svg>
            </button>
          )}
          {/* Логотип — на главную (расписание), как на любом сайте */}
          <button type="button" className="brand" aria-label="На главную — расписание" onClick={() => go('schedule')} {...tipOn('Tish — на главную')}>
            <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={24} height={36} />
            <span>Tish</span>
          </button>
        </div>
        {/* Кто вошёл — внизу, блоком «Я»; здесь только клиника */}
        <div className="clinic">
          <strong>{clinic}</strong>
        </div>
        <nav aria-label="Разделы">
          {sections.map((s) => {
            const subs = subsBy[s.key] ?? []
            const open = subs.length > 0 && expanded(s.key)
            const { total, loud } = sumOf(counts, s.key, subs)
            return (
              <div key={s.key} className={['nav-item', open ? 'open' : '', extra.includes(s) ? 'extra' : '', s.key === page && activeSub(s.key) ? 'sub-active' : ''].join(' ').trim()}
                onMouseEnter={(e) => enter(s.key, e.currentTarget)} onMouseLeave={leave}>
                <div className="nav-row">
                  <button type="button" className={['nav', s.key === page ? 'active' : ''].join(' ').trim()} data-section={s.key} data-tour={`nav-${s.key}`}
                    aria-current={s.key === page ? 'page' : undefined}
                    aria-label={narrow ? (total > 0 ? `${s.title} · новое: ${total}` : s.title) : undefined}
                    {...(subs.length ? {} : tipOn(s.title))}
                    onPointerDown={(e) => pressStart(s.key, e)} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
                    onContextMenu={(e) => { if (subs.length && matches('(max-width: 760px)')) e.preventDefault() }}
                    onKeyDown={(e) => flyKey(s.key, e)}
                    onClick={(e) => clickSection(s.key, e)}>
                    <Icon name={s.key} /> <span>{s.title}</span>
                    {total > 0 && (
                      <span className={loud ? 'nav-badge' : 'nav-badge quiet'} aria-label={`${s.title}: новое — ${total}`}>{total}</span>
                    )}
                  </button>
                  {subs.length > 0 && (
                    <button type="button" className="nav-chev" aria-expanded={open} aria-label={`${open ? 'Свернуть' : 'Раскрыть'} подразделы: ${s.title}`}
                      onClick={() => setToggled((t) => ({ ...t, [s.key]: !open }))}>
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  )}
                </div>
                {open && !narrow && <div className="nav-sub" role="group" aria-label={s.title}>{subLinks(s.key, 'nav-subitem')}</div>}
                {fly?.key === s.key && !phone && (narrow || !open) && (
                  <FlyPanel top={fly.top} left={fly.left} title={s.title} onOpen={() => go(s.key)}>{subLinks(s.key, 'nav-subitem')}</FlyPanel>
                )}
              </div>
            )
          })}
          {/* Телефон: «Ещё» — остальные разделы, свой аватар и «Помощь» (на компьютере кнопки нет) */}
          <button type="button" className={extra.some((s) => s.key === page) || page === 'me' || page === 'help' || more ? 'nav more active' : 'nav more'}
            aria-expanded={more} data-tour="more" onClick={() => { setMenu(null); setMore(!more) }}>
            <Icon name="more" /> <span>Ещё</span>
          </button>
        </nav>
        {me.doctor && !phone && (
          <button ref={helpButton} type="button" className={help || menu === 'help' || page === 'help' ? 'nav help-nav active' : 'nav help-nav'}
            aria-haspopup="dialog" aria-expanded={menu === 'help'} data-tour="help"
            aria-label="Помощь" onClick={() => openMenu('help')} {...tipOn('Помощь')}>
            <Icon name="help" /> <span>Помощь</span>
          </button>
        )}
        {!phone && (
          <button ref={meButton} type="button" className={menu === 'me' || page === 'me' ? 'me-block active' : 'me-block'}
            aria-haspopup="dialog" aria-expanded={menu === 'me'} data-tour="me" aria-label={`${name}, ${role}: профиль, оформление, выход`}
            onClick={() => openMenu('me')} {...tipOn(`${name} · ${role}`)}>
            <Avatar me={me} />
            <span className="me-text"><strong>{name}</strong><span>{role}</span></span>
          </button>
        )}
      </aside>
      {tip && narrow && createPortal(
        <div className="nav-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.text}</div>, document.body)}
      {more && (
        <div className="more-sheet" role="dialog" aria-label="Ещё разделы" onClick={() => setMore(false)}>
          <div ref={moreCard} className="more-card" onClick={(e) => e.stopPropagation()}>
            {/* Свой аватар — лист «Я»: профиль, оформление, уведомления, выход */}
            <button type="button" className={page === 'me' ? 'more-who-btn active' : 'more-who-btn'} aria-label={`${name}, ${role}: профиль, оформление, выход`}
              onClick={() => openMenu('me')}>
              <Avatar me={me} size="lg" />
              <span className="more-who"><strong>{name}</strong><span className="hint">{role} · {clinic}</span></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
            {extra.map((s) => (
              <button key={s.key} type="button" className={s.key === page ? 'more-item active' : 'more-item'} data-section={s.key} onClick={() => go(s.key)}>
                <Icon name={s.key} /> <span>{s.title}</span>
              </button>
            ))}
            {me.doctor && (
              <button type="button" className={page === 'help' ? 'more-item active' : 'more-item'} data-section="help" onClick={() => openMenu('help')}>
                <Icon name="help" /> <span>Помощь</span>
              </button>
            )}
          </div>
        </div>
      )}
      {menu === 'me' && (
        <MenuPanel label="Я: мои настройки" anchor={meButton} phone={phone} head={meHead} onClose={closeMenu}>
          <MeMenuItems me={me} onPick={closeMenu} />
        </MenuPanel>
      )}
      {menu === 'help' && (
        <MenuPanel label="Помощь" anchor={helpButton} phone={phone} head={<><Icon name="help" /><h2>Помощь</h2></>} onClose={closeMenu}>
          <HelpMenuItems me={me} onChat={() => openHelpChat()} onPick={closeMenu} />
        </MenuPanel>
      )}
      {sheetSection && (
        <div className="more-sheet sub-sheet" role="dialog" aria-label={`Подразделы: ${sheetSection.title}`} onClick={() => setSheet(null)}>
          <div ref={subCard} className="more-card" onClick={(e) => e.stopPropagation()}>
            <div className="sub-sheet-head">
              <Icon name={sheetSection.key} /><h2>{sheetSection.title}</h2>
              <button type="button" className="sub-sheet-close" aria-label="Закрыть" onClick={() => setSheet(null)}>✕</button>
            </div>
            {subLinks(sheetSection.key, 'sheet-item')}
            {!extra.includes(sheetSection) && <p className="hint small sub-sheet-tip">Тот же список — долгим нажатием на «{sheetSection.title}» в нижнем меню.</p>}
          </div>
        </div>
      )}
      {/* Напоминания админу и приглашение в опрос — на главном экране, чтобы не занимать место в каждом разделе */}
      <main ref={workspace} className="workspace"><NavContext.Provider value={nav}><div className="sub-tabs-slot" ref={setTabsSlot} /><OfflineNotice />{page === 'schedule' && <><ProfileNotice me={me} /><AdminNotices me={me} /><SurveyInvite me={me} /></>}{children}</NavContext.Provider></main>
      {/* «💬 Помощь» — спросить помощника Tish, не уходя с экрана (ИИ по базе знаний; не знает — команде Tish) */}
      {me.doctor && phone && HELP_PAGES.includes(page) && !help && (
        <button type="button" className="help-fab" onClick={() => openHelpChat()} aria-label="Помощь: спросить помощника Tish">
          <span aria-hidden="true">💬</span>
        </button>
      )}
      {help && (
        <div className="help-float" onClick={(e) => e.target === e.currentTarget && closeHelpChat()}>
          <Suspense fallback={null}><HelpChatPanel key={help.ticketId ?? 'new'} ticketId={help.ticketId} onClose={closeHelpChat} /></Suspense>
        </div>
      )}
      {/* Тур при первом входе (один раз на человека) и «Пройти тур ещё раз» из «Помощи» */}
      <TourHost me={me} page={page} />
      {/* Первый запуск установленного приложения — предложить уведомления (после тура) */}
      <PushPrompt me={me} />
    </div>
  )
}

/**
 * Подразделы у свёрнутого меню — панель рядом с иконкой раздела. Своё место в окне: не выходит за
 * низ экрана (у «Настроек» пунктов много — поднимается выше и прокручивается).
 */
function FlyPanel({ top, left, title, onOpen, children }: { top: number; left: number; title: string; onOpen: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [y, setY] = useState(top)
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setY(Math.max(8, Math.min(top, window.innerHeight - h - 8)))
  }, [top])
  // В body, поверх всего: меню слева — свой слой (sticky), внутри него панель ушла бы под расписание.
  // События React идут по дереву компонентов, а не DOM: уход мыши на панель — не «ушла из раздела»
  return createPortal(
    <div ref={ref} className="nav-fly" role="group" aria-label={title} style={{ top: y, left }}>
      <button type="button" className="nav-fly-head" onClick={onOpen}>{title}</button>
      {children}
    </div>,
    document.body,
  )
}
