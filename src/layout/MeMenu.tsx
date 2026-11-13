import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { logout, type Schemas } from '../api/client'
import { usePlatformInfo } from '../api/platform'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { useBack } from '../lib/back'
import { openMine } from '../lib/route'
import { openLink, telegram } from '../lib/telegram'
import { HELP_ITEMS, ME_ITEMS } from '../settings/items'
import { startTour } from '../tour/state'
import { useSwipeDown } from './useSwipeDown'
import { Icon } from './Icon'
import { initials, whoAmI } from './me'

type Me = Schemas['BookingViewsMe']

/** Кружок с фото врача или инициалами — блок «Я» внизу меню и шапка его листа. */
export function Avatar({ me, size = 'md' }: { me: Me; size?: 'md' | 'lg' }) {
  const { name, photo } = whoAmI(me)
  return photo
    ? <img className={`me-avatar ${size}`} src={photo} alt="" />
    : <span className={`me-avatar ${size}`} aria-hidden="true">{initials(name)}</span>
}

/**
 * Меню блока «Я» или «Помощи». Компьютер — карточка над кнопкой (в свёрнутом меню — справа от неё),
 * телефон — лист снизу, как «Ещё». Закрывается нажатием мимо, Esc и «назад» телефона.
 */
export function MenuPanel({ label, anchor, phone, head, onClose, children }: {
  label: string
  /** Кнопка, к которой привязана карточка (компьютер) */
  anchor: RefObject<HTMLElement | null>
  phone: boolean
  /** Шапка листа (телефон) */
  head?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useBack(onClose)
  // Телефон: лист снизу — потянуть вниз, закрыть
  useSwipeDown(ref, phone ? onClose : null)
  // Место карточки — от кнопки, прямо в стиле (до отрисовки на экране, без лишнего прохода React)
  useLayoutEffect(() => {
    const el = ref.current
    const a = anchor.current
    if (phone || !el || !a) return
    const r = a.getBoundingClientRect()
    // Обычное меню — над кнопкой, вровень с её левым краем; свёрнутое — справа от иконки, низом по ней
    const narrow = a.closest('.shell.narrow') != null
    el.style.left = `${narrow ? r.right + 8 : r.left}px`
    el.style.bottom = `${Math.max(8, window.innerHeight - (narrow ? r.bottom : r.top - 6))}px`
    el.style.visibility = 'visible'
  }, [anchor, phone])
  useEffect(() => {
    if (phone) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Node && (ref.current?.contains(t) || anchor.current?.contains(t))) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [phone, anchor, onClose])
  // Компьютер: первый пункт — в фокус, с клавиатуры сразу листать Tab-ом (на телефоне фокус выглядел бы выбранным пунктом)
  useEffect(() => { if (!phone) ref.current?.querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true }) }, [phone])
  if (phone) {
    return (
      <div className="more-sheet menu-sheet" role="dialog" aria-label={label} onClick={onClose}>
        <div ref={ref} className="more-card" onClick={(e) => e.stopPropagation()}>
          <div className="sub-sheet-head">
            {head}
            <button type="button" className="sub-sheet-close" aria-label="Закрыть" onClick={onClose}>✕</button>
          </div>
          {children}
        </div>
      </div>
    )
  }
  return createPortal(
    <div ref={ref} className="pop-menu" role="dialog" aria-label={label} style={{ visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  )
}

/** Пункт меню «Я» / «Помощи»: значок или эмодзи, подпись, мелкая подсказка. */
function Item({ icon, title, hint, external, tone, onClick }: { icon: ReactNode; title: string; hint?: string; external?: boolean; tone?: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-item" data-icon={tone} onClick={onClick}>
      <span className="menu-ico" aria-hidden="true">{icon}</span>
      <span className="menu-text"><span className="menu-title">{title}</span>{hint && <span className="menu-hint">{hint}</span>}</span>
      {external && <span className="menu-out" aria-hidden="true">↗</span>}
    </button>
  )
}

/** Значки пунктов «Я» и «Помощи» — линейные; у «Я» — приглушённый оттенок по смыслу (`data-icon`, crm.css; DESIGN.md → Colors). */
const ME_ICON: Record<string, ReactNode> = {
  profile: <MiniIcon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.9-4 4-6 8-6s7.1 2 8 6" />,
  appearance: <MiniIcon d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.2-4-7.6-9-7.6zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01" />,
  notifications: <MiniIcon d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  calendar: <MiniIcon d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />,
  install: <MiniIcon d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2" />,
  logout: <MiniIcon d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10" />,
  chat: <Icon name="help" />,
  guide: <MiniIcon d="M12 6.5C10 5 7.2 4.5 3 5v13.5c4.2-.5 7 0 9 1.5 2-1.5 4.8-2 9-1.5V5c-4.2-.5-7 0-9 1.5zM12 6.5V20" />,
  videos: <span className="icon emoji-icon" aria-hidden="true">🎬</span>,
  support: <MiniIcon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5.6 5.6l4.3 4.3M14.1 14.1l4.3 4.3M18.4 5.6l-4.3 4.3M9.9 14.1l-4.3 4.3" />,
  survey: <MiniIcon d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  privacy: <MiniIcon d="M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3" />,
  tour: <MiniIcon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z" />,
  instagram: <MiniIcon d="M4 4h16v16H4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 7h.01" />,
  // «👥» — линией, как остальные значки меню
  group: <MiniIcon d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2" />,
}

function MiniIcon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  )
}

/**
 * Пункты блока «Я»: мой профиль, оформление, уведомления, календарь (у врача с креслом), установить
 * приложение и «Выйти» (только на сайте — в Telegram выходить не из чего).
 */
export function MeMenuItems({ me, onPick }: { me: Me; onPick: () => void }) {
  return (
    <>
      {ME_ITEMS.filter((i) => !i.hidden && i.show(me)).map((i) => (
        <Item key={i.key} icon={ME_ICON[i.key]} tone={i.key} title={i.title} onClick={() => { onPick(); openMine('me', i.key) }} />
      ))}
      {!telegram() && (
        <>
          <hr className="menu-sep" />
          <Item icon={ME_ICON.logout} tone="logout" title="Выйти" onClick={() => { onPick(); void logout() }} />
        </>
      )}
    </>
  )
}

/**
 * Пункты «Помощи»: первым — чат с помощником (окно поверх, не уводит с экрана), затем руководство,
 * техподдержка (обращения), отзыв, конфиденциальность, «Пройти тур ещё раз», группа врачей Tish и Instagram Tish (ссылки наружу).
 */
export function HelpMenuItems({ me, onChat, onPick }: { me: Me; onChat: () => void; onPick: () => void }) {
  return (
    <>
      <Item icon={ME_ICON.chat} title="Спросить помощника" hint="Чат: ответит сразу, не знает — передаст команде Tish" onClick={() => { onPick(); onChat() }} />
      {HELP_ITEMS.filter((i) => !i.hidden && i.show(me)).map((i) => (
        <Item key={i.key} icon={ME_ICON[i.key]} title={i.title} onClick={() => { onPick(); openMine('help', i.key) }} />
      ))}
      {/* Тот же тур, что при первом входе: 4–6 подсказок по главным местам */}
      <Item icon={ME_ICON.tour} title="Пройти тур ещё раз" hint="Подсказки по главным местам Tish" onClick={() => { onPick(); startTour() }} />
      <DoctorsGroupItem onPick={onPick} />
      <Item icon={ME_ICON.instagram} title="Tish в Instagram" hint={`${TISH_INSTAGRAM_NAME} — видео-инструкции`} external
        onClick={() => { onPick(); openLink(TISH_INSTAGRAM) }} />
    </>
  )
}

/**
 * «👥 Группа врачей Tish» — общая Telegram-группа сотрудников клиник (ссылка из «Сведений о платформе», V194).
 * Ссылки нет (или сведения не загрузились) — пункта нет. «Помощь» — только у сотрудников, пациентам её не видно.
 */
function DoctorsGroupItem({ onPick }: { onPick: () => void }) {
  const url = usePlatformInfo().data?.doctorsGroupUrl
  if (!url) return null
  return (
    <Item icon={ME_ICON.group} title="Группа врачей Tish" hint="Новости, короткие видео «Как сделать», ответы на вопросы" external
      onClick={() => { onPick(); openLink(url) }} />
  )
}
