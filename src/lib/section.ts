import { createContext, useContext } from 'react'

/**
 * Раздел на экране или скрыт (App держит открытые разделы живыми). Скрытый не перехватывает
 * «назад» Telegram и Esc — их получает только тот, что на экране.
 */
export const SectionActive = createContext(true)

export function useSectionActive(): boolean {
  return useContext(SectionActive)
}
