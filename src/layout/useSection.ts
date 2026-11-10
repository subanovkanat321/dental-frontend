import { createContext, useMemo } from 'react'

import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { useSub } from '../lib/sub'
import { currentSub, subsOf, type Sub } from './nav'

type Me = Schemas['BookingViewsMe']

/** Меню (Shell) даёт разделам открыть лист подразделов — заголовок «Пациенты · Записаны ▾» на телефоне. */
export const NavContext = createContext<{ openSheet: (page: Page) => void } | null>(null)

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

