import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { logout, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { openSettings, settingsItem, type Page } from '../lib/route'
import { openSub, subHref, useSub } from '../lib/sub'
import { matches } from '../lib/useMedia'
import { useWaitlist } from '../api/settings'
import { countOf, currentSub, LOUD, subsOf, sumOf, type Counts, type Sub } from './nav'
import { NavContext } from './useSection'
import { telegram } from '../lib/telegram'
import { AdminNotices } from './AdminNotices'
import { PasswordNotice } from './PasswordNotice'
import { ProfileNotice } from './ProfileNotice'
import { Icon } from './Icon'
import { useFitPanels } from './fitPanels'
import { isAssistant } from '../lib/roles'
import { SurveyInvite } from '../survey/SurveyInvite'
import { useNewQuestions } from '../api/questions'
import { useFullView } from '../lib/fullView'

type Me = Schemas['BookingViewsMe']

// Чат «Помощь» — отдельным кусочком: грузится, только когда его открыли
const HelpChatPanel = lazy(() => import('../account/HelpChat').then((m) => ({ default: m.HelpChatPanel })))

/** Где видна кнопка «💬 Помощь»: главные экраны клиники (в «Настройках» помощь — свой пункт). */
const HELP_PAGES: Page[] = ['schedule', 'patients', 'cash', 'stock']

/** Разделы клиники — сотрудникам; «Платформа» — команде Tish (владелец и менеджеры). */
const CLINIC_SECTIONS = [
  { key: 'schedule', title: 'Расписание' },
  { key: 'patients', title: 'Пациенты' },
  // 3D-атлас и презентации — показать пациенту на консультации; всем сотрудникам клиники
  { key: 'learn', title: 'Для пациента' },
  { key: 'cash', title: 'Касса' },
  { key: 'stock', title: 'Склад' },
  { key: 'settings', title: 'Настройки' },
] as const
const PLATFORM = { key: 'platform', title: 'Платформа' } as const

function sectionsOf(me: Me): readonly { key: Page; title: string }[] {
  // Ассистенту — без «Кассы»: денег он не видит
  const clinic = isAssistant(me) ? CLINIC_SECTIONS.filter((s) => s.key !== 'cash') : CLINIC_SECTIONS
  return [...(me.doctor ? clinic : []), ...(me.platform ? [PLATFORM] : [])]
}

/**
 * Телефон сотрудника клиники: внизу расписание, пациенты, касса, склад и «Настройки». «Для пациента»
 * и «Платформа» туда не влезли — они пунктами в «Настройках».
 */
const PHONE_IN_SETTINGS: readonly Page[] = ['learn', 'platform']

/** На телефоне внизу помещается 4 раздела и «Ещё»: остальное — в выезжающем меню. */
const MOBILE_MAIN = 4

/** Старые адреса пунктов «Настроек» — в дереве подсвечиваем пункт, который они открывают. */
const SETTINGS_ALIAS: Record<string, string> = { shifts: 'hours', timeoff: 'hours', promo: 'sources', help: 'support' }

/** Долгое нажатие на кнопку раздела внизу (телефон) — лист подразделов. */
const LONG_PRESS_MS = 500

/** Пункт «Настроек» из адреса — следим за ним: меню подсвечивает открытый пункт. */
function useSettingsItem(): string | null {
  const [item, setItem] = useState(settingsItem)
  useEffect(() => {
    const onHash = () => setItem(settingsItem())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return item
}

/**
 * Раскладка CRM: меню слева деревом — разделы (по ролям), под открытым разделом его подразделы
 * (бывшие вкладки сверху: «Пациенты → Лист ожидания», «Касса → Зарплата», пункты «Настроек» по
 * группам). Стрелка › у другого раздела раскрывает его подразделы, не уводя с экрана. Свёрнутое
 * меню — полоса иконок: подразделы всплывают панелью при наведении (на сенсорном экране — по нажатию).
 * У свёрнутого раздела — сумма чисел его подразделов.
 *
 * Телефон: меню — полоса внизу (расписание, пациенты, касса, склад и «Настройки»; у команды
 * платформы — ещё «Ещё»). Подразделы — листом снизу: из заголовка раздела «Пациенты · Записаны ▾»
 * (layout/section.tsx) или долгим нажатием на кнопку раздела внизу.
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
    patients: useSub('patients'), cash: useSub('cash'), stock: useSub('stock'), platform: useSub('platform'),
  }
  const item = useSettingsItem()
  const subsBy = useMemo(() => Object.fromEntries(sections.map((s) => [s.key, subsOf(s.key, me)])) as Record<Page, Sub[]>, [sections, me])
  const activeSub = (key: Page): string | null => key === 'settings'
    ? (item ? SETTINGS_ALIAS[item] ?? item : null)
    : currentSub(subsBy[key] ?? [], chosen[key])
  // «Для пациента» и «Платформа» у сотрудника клиники на телефоне — в «Настройках»: внизу пять кнопок без «Ещё»
  const extra = me.doctor ? sections.filter((x) => PHONE_IN_SETTINGS.includes(x.key))
    : sections.length > MOBILE_MAIN + 1 ? sections.slice(MOBILE_MAIN) : []
  const moreButton = extra.length > 0 && !me.doctor
  const [more, setMore] = useState(false)
  // «Ещё» снизу — тоже слой: «назад» телефона закрывает его, а не уводит из раздела
  useBack(more ? () => setMore(false) : null)
  // Лист подразделов (телефон): «назад» закрывает его
  const [sheet, setSheet] = useState<Page | null>(null)
  useBack(sheet ? () => setSheet(null) : null)
  const [help, setHelp] = useState(false)
  // Компьютер: меню можно свернуть до полосы иконок — расписанию больше места (выбор запоминается)
  const [narrow, toggleNarrow] = useFullView('sidebar-narrow')
  // Раскрыт открытый раздел; стрелкой можно раскрыть другой или свернуть открытый. Не запоминаем:
  // перешли в другой раздел — снова раскрыт только он
  const [toggled, setToggled] = useState<Partial<Record<Page, boolean>>>({})
  const [toggledFor, setToggledFor] = useState(page)
  if (toggledFor !== page) {
    setToggledFor(page)
    setToggled({})
  }
  const expanded = (key: Page) => toggled[key] ?? key === page
  // Свёрнутое меню: панель подразделов у раздела под мышью (или нажатого пальцем)
  const [fly, setFly] = useState<{ key: Page; top: number; left: number } | null>(null)
  const flyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pointer = useRef<string>('mouse')
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pressed = useRef(false)
  // Панель справа — целиком в окне, прокрутка внутри неё (layout/fitPanels.ts)
  const workspace = useRef<HTMLElement>(null)
  useFitPanels(workspace)
  useEffect(() => () => { clearTimeout(flyTimer.current); clearTimeout(pressTimer.current) }, [])
  // Панель по нажатию закрывается нажатием мимо неё и Esc
  useEffect(() => {
    if (!fly) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.nav-item, .nav-fly')) setFly(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFly(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [fly])
  const go = (key: Page) => {
    setMore(false)
    setFly(null)
    onNavigate(key)
  }
  const goSub = (key: Page, sub: string) => {
    setMore(false)
    setFly(null)
    setSheet(null)
    if (key === 'settings') openSettings(sub)
    else openSub(key, sub)
  }
  const showFly = (key: Page, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setFly({ key, top: r.top, left: r.right + 6 })
  }
  const enter = (key: Page, el: HTMLElement) => {
    if (!narrow || !subsBy[key]?.length || pointer.current === 'touch') return
    clearTimeout(flyTimer.current)
    flyTimer.current = setTimeout(() => showFly(key, el), fly ? 0 : 120)
  }
  const leave = () => {
    if (!narrow || pointer.current === 'touch') return
    clearTimeout(flyTimer.current)
    flyTimer.current = setTimeout(() => setFly(null), 200)
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
            <span className="nav-sub-title">{s.title}</span>
            {n > 0 && <span className={LOUD.has(`${key}/${s.key}`) ? 'nav-count' : 'nav-count quiet'} aria-hidden="true">{n}</span>}
            {className === 'sheet-item' && on && <span className="sheet-check" aria-hidden="true">✓</span>}
          </a>
        </Fragment>
      )
    })
  }
  const nav = useMemo(() => ({ openSheet: (key: Page) => setSheet(key) }), [])
  const sheetSection = sheet ? sections.find((s) => s.key === sheet) : undefined
  return (
    <div className={narrow ? 'shell narrow' : 'shell'}>
      <aside className="sidebar">
        {/* Логотип — на главную (расписание), как на любом сайте */}
        <button type="button" className="brand" aria-label="На главную — расписание" onClick={() => go('schedule')}>
          <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={24} height={36} />
          <span>Tish</span>
        </button>
        <div className="clinic">
          <strong>{clinic}</strong>
          <span>{me.fullName ? `${me.fullName} · ` : ''}{role}</span>
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
                  <button type="button" className={['nav', s.key === page ? 'active' : ''].join(' ').trim()} data-section={s.key}
                    aria-current={s.key === page ? 'page' : undefined} title={narrow ? s.title : undefined}
                    onPointerDown={(e) => pressStart(s.key, e)} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
                    onContextMenu={(e) => { if (subs.length && matches('(max-width: 760px)')) e.preventDefault() }}
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
                {narrow && fly?.key === s.key && (
                  <FlyPanel top={fly.top} left={fly.left} title={s.title} onOpen={() => go(s.key)}>{subLinks(s.key, 'nav-subitem')}</FlyPanel>
                )}
              </div>
            )
          })}
          {moreButton && (
            <button type="button" className={extra.some((s) => s.key === page) || more ? 'nav more active' : 'nav more'}
              aria-expanded={more} onClick={() => setMore(!more)}>
              <Icon name="more" /> <span>Ещё</span>
            </button>
          )}
        </nav>
        <button type="button" className="nav sidebar-toggle" aria-expanded={!narrow} onClick={() => { setFly(null); toggleNarrow() }}
          title={narrow ? 'Развернуть меню' : 'Свернуть меню'} aria-label={narrow ? 'Развернуть меню' : 'Свернуть меню'}>
          <span className="sidebar-toggle-ico" aria-hidden="true">{narrow ? '»' : '«'}</span> <span>Свернуть меню</span>
        </button>
        {!telegram() && (
          <button type="button" className="nav link-out" title={narrow ? 'Выйти' : undefined} onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>
        )}
      </aside>
      {more && (
        <div className="more-sheet" role="dialog" aria-label="Ещё разделы" onClick={() => setMore(false)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            <p className="more-who"><strong>{clinic}</strong><span className="hint">{me.fullName ? `${me.fullName} · ` : ''}{role}</span></p>
            {extra.map((s) => (
              <button key={s.key} type="button" className={s.key === page ? 'more-item active' : 'more-item'} onClick={() => go(s.key)}>
                <Icon name={s.key} /> <span>{s.title}</span>
              </button>
            ))}
            {!telegram() && <button type="button" className="more-item" onClick={() => void logout()}><Icon name="external" /> <span>Выйти</span></button>}
          </div>
        </div>
      )}
      {sheetSection && (
        <div className="more-sheet sub-sheet" role="dialog" aria-label={`Подразделы: ${sheetSection.title}`} onClick={() => setSheet(null)}>
          <div className="more-card" onClick={(e) => e.stopPropagation()}>
            <div className="sub-sheet-head">
              <Icon name={sheetSection.key} /><h2>{sheetSection.title}</h2>
              <button type="button" className="sub-sheet-close" aria-label="Закрыть" onClick={() => setSheet(null)}>✕</button>
            </div>
            {subLinks(sheetSection.key, 'sheet-item')}
            <p className="hint small sub-sheet-tip">Тот же список — долгим нажатием на «{sheetSection.title}» в нижнем меню.</p>
          </div>
        </div>
      )}
      {/* Напоминания админу и приглашение в опрос — на главном экране, чтобы не занимать место в каждом разделе */}
      <main ref={workspace} className="workspace"><NavContext.Provider value={nav}>{page === 'schedule' && <><PasswordNotice /><ProfileNotice me={me} /><AdminNotices me={me} /><SurveyInvite me={me} /></>}{children}</NavContext.Provider></main>
      {/* «💬 Помощь» — спросить помощника Tish, не уходя с экрана (ИИ по базе знаний; не знает — команде Tish) */}
      {me.doctor && HELP_PAGES.includes(page) && !help && (
        <button type="button" className="help-fab" onClick={() => setHelp(true)} aria-label="Помощь: спросить помощника Tish">
          <span aria-hidden="true">💬</span> <span className="help-fab-text">Помощь</span>
        </button>
      )}
      {help && (
        <div className="help-float">
          <Suspense fallback={null}><HelpChatPanel onClose={() => setHelp(false)} /></Suspense>
        </div>
      )}
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
