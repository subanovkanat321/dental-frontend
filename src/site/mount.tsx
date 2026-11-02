import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

// Мало начертаний: страница сайта открывается с телефона по мобильному интернету. Латиница — для
// «Tish», «Telegram», «WhatsApp» и цифр телефонов (без неё они рисовались системным шрифтом)
import '@fontsource/geologica/cyrillic-600.css'
import '@fontsource/geologica/latin-600.css'
import '@fontsource/golos-text/cyrillic-400.css'
import '@fontsource/golos-text/latin-400.css'
import '@fontsource/golos-text/cyrillic-500.css'
import '@fontsource/golos-text/latin-500.css'
import '@fontsource/golos-text/cyrillic-600.css'
import '@fontsource/golos-text/latin-600.css'
import '../styles.css'
import './site.css'

/**
 * Страницы сайта (/clinics, /c/<код>, /join, /go) — отдельные лёгкие входы Vite: без CRM, без
 * React Query и без скрипта Telegram. Свой HTML у каждой — свои og:-теги для превью ссылки.
 */
export function mount(page: ReactNode): void {
  // Всегда светлые, как посты Instagram: в тёмной теме телефона (и во встроенном браузере
  // Instagram) страница была тёмной. data-theme=light отключает тёмные цвета из styles.css
  document.documentElement.dataset.theme = 'light'
  createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)
}
