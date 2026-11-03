/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Бэкенд (subanovkanat321/dental) на ноутбуке: ./mvnw spring-boot:run
const backend = process.env.DENTAL_BACKEND ?? 'http://localhost:8080'

/**
 * Service worker (PWA, src/pwa/sw.js) → dist/sw.js с версией сборки: хеш имён всех файлов сборки
 * (в них хеш содержимого) и самого шаблона. Поменялся код — поменялся sw.js, браузер ставит новую
 * версию и CRM предлагает «Обновить». Только в сборке: в npm run dev service worker не нужен.
 */
function serviceWorker(): Plugin {
  return {
    name: 'tish-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(resolve(import.meta.dirname, 'src/pwa/sw.js'), 'utf8')
      const version = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).update(template).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('__SW_VERSION__', version) })
    },
  }
}

export default defineConfig({
  // Весь фронт — с корня домена (ADR 0002 бэкенда, этап 5): CRM и Mini App — index.html, страницы
  // сайта — site/*.html; nginx раскладывает адреса (deploy/nginx/default.conf.template бэкенда)
  base: '/',
  plugins: [react(), serviceWorker()],
  build: {
    rollupOptions: {
      // CRM и Mini App — index.html; страницы сайта — свои HTML с og:-тегами и лёгкими скриптами
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ...Object.fromEntries(['clinic', 'clinics', 'join', 'go', 'call', 'guide', 'plan'].map((name) => [name, resolve(import.meta.dirname, `site/${name}.html`)])),
      },
    },
  },
  server: {
    // Тот же origin, что на проде: браузер ходит на localhost:5173, Vite передаёт /api, /web и
    // /doctors (фото врачей) в Spring Boot — без CORS, cookie-сессия сайта (dental_session) работает как за nginx
    proxy: {
      '/api': backend,
      '/web': backend,
      '/doctors': backend,
      // Вход без Telegram на ноутбуке: подпись у бэкенда в профиле local (lib/telegram.ts → startDevLogin)
      '/dev/init-data': backend,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    unstubGlobals: true,
    // Больше asyncUtilTimeout (5 с) из setup.ts: тест с несколькими ожиданиями успевает дождаться
    testTimeout: 20_000,
  },
})
