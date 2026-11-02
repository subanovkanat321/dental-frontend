import { QueryClientProvider } from '@tanstack/react-query'
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

import { createQueryClient } from './api/queryClient'
import { App } from './App'
import { ErrorBoundary } from './layout/ErrorBoundary'
import { startDevLogin, startTelegram, telegram } from './lib/telegram'
import { startButtonIcons } from './lib/buttonIcons'
import { applyLook } from './lib/theme'
import './styles.css'

// Регистратура держит вкладку открытой весь день: вернулись на вкладку — свежие данные
const queryClient = createQueryClient({ queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } })

startTelegram()
// Тема и размер текста — до первой отрисовки; «как в Telegram/системе» следит за сменой
applyLook()
telegram()?.onEvent?.('themeChanged', applyLook)
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyLook)

function render(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </StrictMode>,
  )
}

// На ноутбуке (npm run dev) — сначала вход без Telegram (lib/telegram.ts → startDevLogin)
if (import.meta.env.DEV) void startDevLogin().then(render)
else render()

// Эмодзи у кнопок по подписи — как в прежнем приложении
startButtonIcons()

// Перезагрузка «вышла новая версия» — одна; проработали минуту без сбоев — снова разрешена
setTimeout(() => {
  try {
    sessionStorage.removeItem('crm.reloadedForUpdate')
  } catch {
    // нет хранилища
  }
}, 60_000)
