import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { HelpHint } from '../help/HelpHint'
import { useSectionActive } from '../lib/section'
import { HeadSlotContext } from './headSlot'
import { stickyHead } from './stickyHead'
import { NavContext } from './useSection'

/**
 * Шапка страницы — одна строка-панель (DESIGN.md → Layout): слева заголовок (мелко раздел, крупно
 * подраздел), за ним в той же строке — инструменты подраздела (период, фильтры, пояснение мелко),
 * справа — общие для раздела («Вся клиника», главная кнопка). На компьютере прилипает к верху.
 *
 * Инструменты рисует сам подраздел (у него их состояние), а место им — в шапке раздела: подраздел
 * кладёт их через `<HeadTools>` порталом в `head-tools` шапки. Без шапки (подраздел в тесте или
 * в другом месте) — своей строкой-панелью на месте.
 *
 * `HeadSlotProvider` даёт подразделам место в шапке: оборачивает шапку и содержимое страницы.
 */
export function HeadSlotProvider({ slot, children }: { slot: HTMLElement | null; children: ReactNode }) {
  return <HeadSlotContext.Provider value={slot}>{children}</HeadSlotContext.Provider>
}

/**
 * `<header class="toolbar sticky-head">`: заголовок, место под инструменты подраздела (`slotRef`)
 * и общие элементы раздела (`children`, обычно справа).
 */
export function PageHead({ title, slotRef, className, children }: {
  title: ReactNode
  slotRef?: (el: HTMLElement | null) => void
  className?: string
  children?: ReactNode
}) {
  return (
    <header ref={stickyHead} className={['toolbar sticky-head page-head', className].filter(Boolean).join(' ')}>
      {title}
      {slotRef && <div className="head-tools" ref={slotRef} />}
      {children}
    </header>
  )
}

/** Инструменты подраздела — в строку шапки раздела (или своей строкой, если шапки нет). */
export function HeadTools({ children }: { children: ReactNode }) {
  const slot = useContext(HeadSlotContext)
  if (slot) return createPortal(children, slot)
  return <div className="toolbar head-tools-inline">{children}</div>
}

/**
 * «?» подраздела, у которого других инструментов в шапке нет. Заголовок подраздела скрыт (он во вкладках),
 * и `<HeadTools><HelpHint/></HeadTools>` давал строку-шапку с одним кружком на всю ширину. Поэтому «?» —
 * в полосу вкладок, в конец строки (место `nav.helpSlot` от SubTabs, layout/section.tsx): там уже стоит
 * «?» раздела, и подраздела его заменяет. Полосы нет (раздел без вкладок, «Настройки», тест) — как раньше,
 * через `HeadTools`. Есть ещё инструменты (месяц, фильтры) — не он: `HelpHint` первым в `HeadTools`.
 */
export function SubHelp({ title, children }: { title: string; children: ReactNode }) {
  const nav = useContext(NavContext)
  // Скрытый раздел (App держит открытые живыми) не кладёт «?» в полосу видимого
  const visible = useSectionActive()
  const hint = <HelpHint title={title}>{children}</HelpHint>
  if (nav?.helpSlot) return visible ? createPortal(hint, nav.helpSlot) : null
  return <HeadTools>{hint}</HeadTools>
}
