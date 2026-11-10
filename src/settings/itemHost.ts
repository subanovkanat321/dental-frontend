import { createContext } from 'react'

/**
 * Где открыт пункт: в «Настройках», в разделе «Клиника», из блока «Я» или из «Помощи» (внизу меню).
 * Экраны пунктов одни и те же — от места зависят только шапка и «назад» (SubHeader).
 */
export type ItemHostKind = 'settings' | 'clinic' | 'me' | 'help'
export const ItemHost = createContext<ItemHostKind>('settings')
