import { createContext, useMemo } from 'react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { useSub } from '../lib/sub'
import { currentSub, subsOf, type Counts, type Sub } from './nav'

type Me = Schemas['BookingViewsMe']

/**
 * Меню (Shell) даёт разделам свои подразделы на телефоне: панель вкладок (layout/section.tsx)
 * переключает сразу, «⌄» открывает лист, числа — те же, что в меню.
 */
export type NavApi = {
  openSheet: (page: Page) => void
  /** Подразделы раздела (по правам) */
  subs: (page: Page) => Sub[]
  /** Открытый подраздел раздела */
  active: (page: Page) => string | null
  /** Перейти в подраздел — как из меню */
  go: (page: Page, sub: string) => void
  /** Числа у подразделов: вопросы, лист ожидания */
  counts: Counts
  /** Место панели вкладок (телефон) — первым в рабочей области, вне шапки страницы: так она прилипает к верху */
  tabsSlot: HTMLElement | null
}
export const NavContext = createContext<NavApi | null>(null)

/**
 * Подраздел, открытый в разделе: список (по правам), ключ (из адреса или первый) и его название.
 * Им раздел решает, что рисовать, — вместо прежнего useState вкладок.
 */
export function useSection(page: Page, me: Me): { subs: Sub[]; sub: string | null; subTitle: string | null } {
  const subs = useMemo(() => subsOf(page, me), [page, me])
  const chosen = useSub(page)
  const sub = currentSub(subs, chosen)
  return { subs, sub, subTitle: subs.find((s) => s.key === sub)?.title ?? null }
}

