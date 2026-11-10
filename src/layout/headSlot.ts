import { createContext, useState } from 'react'

/** Место в шапке страницы под инструменты подраздела (layout/PageHead.tsx: `HeadTools` кладёт их туда порталом). */
export const HeadSlotContext = createContext<HTMLElement | null>(null)

/** `const [slot, setSlot] = useHeadSlot()`: `setSlot` — в `PageHead slotRef`, `slot` — в `HeadSlotProvider`. */
export function useHeadSlot() {
  return useState<HTMLElement | null>(null)
}
