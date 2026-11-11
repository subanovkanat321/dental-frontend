/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Declaration } from 'postcss'
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

/** Версия сборки для pwa/version.ts: хеш имён JS и CSS сборки (в них хеш содержимого). */
function buildVersion(bundle: Record<string, unknown>): string {
  const files = Object.keys(bundle).filter((name) => /^assets\/.+\.(js|css)$/.test(name)).sort()
  return createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
}

/**
 * Версия сборки → dist/version.json и `<meta name="tish-version">` в index.html (одна и та же: считается
 * из одних файлов). Открытая вкладка, PWA и Mini App в Telegram сверяют их (pwa/version.ts) и тихо
 * обновляются на новую версию. nginx отдаёт version.json без кэша.
 */
function versionFile(): Plugin {
  const PLACEHOLDER = '__TISH_VERSION__'
  return {
    name: 'tish-version',
    apply: 'build',
    // После плагина HTML Vite: в generateBundle index.html уже в сборке
    enforce: 'post',
    // Мета — с меткой: в момент обработки HTML ещё не все файлы сборки известны, версию ставим в generateBundle
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('/index.html') || ctx.filename.includes('/site/')) return html
        return { html, tags: [{ tag: 'meta', attrs: { name: 'tish-version', content: PLACEHOLDER }, injectTo: 'head' }] }
      },
    },
    generateBundle(_options, bundle) {
      const version = buildVersion(bundle)
      const index = bundle['index.html']
      if (index?.type !== 'asset' || typeof index.source !== 'string' || !index.source.includes(PLACEHOLDER)) {
        this.error('tish-version: нет index.html с меткой версии')
      }
      index.source = index.source.replace(PLACEHOLDER, version)
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version })}\n` })
    },
  }
}

/**
 * Запасной цвет для старых браузеров: color-mix() — с Chrome 111, а на Windows 7/8.1 последний Chrome —
 * 109 (у клиник такие компьютеры есть). Без запаса браузер выбрасывает правило целиком: пропадают
 * цветные фоны строк дня, подсветка выбранного врача, фон предупреждений. Перед каждым правилом с
 * color-mix(in srgb, A N%, B) ставим то же правило с A (или transparent, если смешивали с прозрачным:
 * полупрозрачный слой лучше не показать, чем закрыть им расписание). Новый браузер берёт второе
 * правило — с color-mix, старый — первое.
 */
const MIX = /color-mix\(in srgb,\s*([^,()]+(?:\([^()]*\))?)\s+\d+%,\s*([^,()]+(?:\([^()]*\))?)\s*\)/g
export function colorMixFallback(value: string): string | null {
  if (!value.includes('color-mix(')) return null
  const plain = value.replace(MIX, (_m, a: string, b: string) => (b.trim() === 'transparent' ? 'transparent' : a.trim()))
  return plain.includes('color-mix(') ? null : plain
}
const colorMixPostcss = {
  postcssPlugin: 'tish-color-mix-fallback',
  Declaration(decl: Declaration) {
    if (decl.prop.startsWith('--')) return
    const fallback = colorMixFallback(decl.value)
    if (fallback != null) decl.cloneBefore({ value: fallback })
  },
}

export default defineConfig({
  // Весь фронт — с корня домена (ADR 0002 бэкенда, этап 5): CRM и Mini App — index.html, страницы
  // сайта — site/*.html; nginx раскладывает адреса (deploy/nginx/default.conf.template бэкенда)
  base: '/',
  plugins: [react(), serviceWorker(), versionFile()],
  css: { postcss: { plugins: [colorMixPostcss] } },
  build: {
    // Самый большой чанк — three.js 3D-атласа (engine, около 615 КБ, 160 КБ gzip): грузится только
    // при открытии атласа и дробить его незачем. Порог выше него, чтобы предупреждение ловило новые
    // разросшиеся чанки, а не этот
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      // CRM и Mini App — index.html; страницы сайта — свои HTML с og:-тегами и лёгкими скриптами
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ...Object.fromEntries(['clinic', 'clinics', 'join', 'go', 'call', 'guide', 'plan', 'learn', 'about'].map((name) => [name, resolve(import.meta.dirname, `site/${name}.html`)])),
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
