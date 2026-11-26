import { createContext, type ReactNode } from 'react'

/**
 * Где открыт пункт: в «Настройках», в разделе «Клиника», из блока «Я» или из «Помощи» (внизу меню).
 * Экраны пунктов одни и те же — от места зависят только шапка и «назад» (SubHeader).
 */
export type ItemHostKind = 'settings' | 'clinic' | 'me' | 'help'
export const ItemHost = createContext<ItemHostKind>('settings')

/**
 * Пункт «Настроек» с вкладками (с 2026-11-26: «Сообщения пациентам» = напоминания, оценка, WhatsApp…): экран вкладки —
 * прежний экран пункта со своей шапкой (SubHeader), а в шапке — название объединённого пункта и его вкладки.
 * Так не нужно учить каждый экран принимать вкладки.
 */
export const ItemChrome = createContext<{ title: string; tabs: ReactNode } | null>(null)
