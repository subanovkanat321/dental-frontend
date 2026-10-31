import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

// Только два начертания: страница сайта открывается с телефона по мобильному интернету
import '@fontsource/geologica/cyrillic-700.css'
import '@fontsource/golos-text/cyrillic-400.css'
import '@fontsource/golos-text/cyrillic-600.css'
import '../styles.css'
import './site.css'

/**
 * Страницы сайта (/clinics, /c/<код>, /join, /go) — отдельные лёгкие входы Vite: без CRM, без
 * React Query и без скрипта Telegram. Свой HTML у каждой — свои og:-теги для превью ссылки.
 */
export function mount(page: ReactNode): void {
  createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)
}
