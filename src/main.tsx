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
// Стили — до компонентов: их собственные .css (pwa.css, timeinput.css…) должны идти после общих, как раньше
import './tokens.css'
import './crm.css'

import { createQueryClient } from './api/queryClient'
import { App } from './App'
import { ErrorBoundary } from './layout/ErrorBoundary'
import { startDevLogin, startTelegram, telegram } from './lib/telegram'
import { startButtonIcons } from './lib/buttonIcons'
import { startEdgeSwipe } from './lib/edgeSwipe'
import { startErrorReports } from './lib/clientErrors'
import { startTableLabels } from './lib/tableLabels'
import { startVisualViewport } from './lib/visualViewport'
import { applyLook } from './lib/theme'
import { listenInstallPrompt } from './pwa/pwa'
import { startVersionCheck } from './pwa/version'

// Регистратура держит вкладку открытой весь день: вернулись на вкладку — свежие данные
// Повторы — retryOnce (api/queryClient.ts): 4xx не повторяем, сеть и 5xx — один раз
const queryClient = createQueryClient({ queries: { staleTime: 30_000, refetchOnWindowFocus: true } })

// Ошибки с устройств врачей — владельцу в бот (без данных пациентов); первым делом, до отрисовки
startErrorReports()
startTelegram()
// «Можно установить» (PWA) браузер присылает один раз и рано — ловим до первой отрисовки
listenInstallPrompt()
// Новая версия на сервере — тихо обновиться в безопасный момент (везде, и в Telegram: pwa/version.ts)
startVersionCheck()
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
startTableLabels()
// «Назад» свайпом от левого края — в PWA и Telegram на iPhone (lib/edgeSwipe.ts)
startEdgeSwipe()
// iPhone: карточка на весь экран — ровно в видимой части, и после клавиатуры ✕ не уезжает (lib/visualViewport.ts)
startVisualViewport()

// Перезагрузка «вышла новая версия» — одна; проработали минуту без сбоев — снова разрешена
setTimeout(() => {
  try {
    sessionStorage.removeItem('crm.reloadedForUpdate')
  } catch {
    // нет хранилища
  }
}, 60_000)
