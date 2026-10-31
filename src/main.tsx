import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Шрифты — свои, без Google: компьютеры клиники не ходят к сторонним серверам (DESIGN.md)
import '@fontsource/geologica/cyrillic-500.css'
import '@fontsource/geologica/latin-500.css'
import '@fontsource/geologica/cyrillic-600.css'
import '@fontsource/geologica/latin-600.css'
import '@fontsource/geologica/cyrillic-700.css'
import '@fontsource/geologica/latin-700.css'
import '@fontsource/golos-text/cyrillic-400.css'
import '@fontsource/golos-text/latin-400.css'
import '@fontsource/golos-text/cyrillic-500.css'
import '@fontsource/golos-text/latin-500.css'
import '@fontsource/golos-text/cyrillic-600.css'
import '@fontsource/golos-text/latin-600.css'
import '@fontsource/golos-text/cyrillic-700.css'
import '@fontsource/golos-text/latin-700.css'
import '@fontsource/jetbrains-mono/cyrillic-400.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/cyrillic-500.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/cyrillic-600.css'
import '@fontsource/jetbrains-mono/latin-600.css'

import { App } from './App'
import { startTelegram, telegram } from './lib/telegram'
import { startButtonIcons } from './lib/buttonIcons'
import { applyLook } from './lib/theme'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // Регистратура держит вкладку открытой весь день: вернулись на вкладку — свежие данные
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
})

startTelegram()
// Тема и размер текста — до первой отрисовки; «как в Telegram/системе» следит за сменой
applyLook()
telegram()?.onEvent?.('themeChanged', applyLook)
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyLook)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

// Эмодзи у кнопок по подписи — как в прежнем приложении
startButtonIcons()
