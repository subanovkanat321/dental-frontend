import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHARE_PAGES, sharePageHtml } from '../../vite.config'

// Готовый index.html сборки: из исходного шаблона, со скриптом-бандлом, стилями и меткой версии, как их ставит Vite
const built = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>', '')
  .replace(
    '</head>',
    '  <script type="module" crossorigin src="/assets/main-AbC123.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/main-XyZ789.css">\n    <meta name="tish-version" content="0123456789ab">\n  </head>',
  )

const start = SHARE_PAGES.find((p) => p.file === 'start')!

const content = (html: string, attr: string) => [...html.matchAll(new RegExp(`<meta (?:name|property)="${attr}" content="([^"]*)"`, 'g'))].map((m) => m[1])

test('index.html: общее превью «Tish — программа для стоматологии» с картинкой, а не голое «Tish CRM»', () => {
  expect(content(built, 'og:title')).toEqual(['Tish — программа для стоматологии'])
  expect(content(built, 'og:image')).toEqual(['https://tish.kg/about/og-about.jpg'])
})

test.each(SHARE_PAGES)('$file.html: свой title и превью, бандл и версия — те же, что у index.html', (page) => {
  const html = sharePageHtml(built, page)
  expect(html).toContain(`<title>${page.title}</title>`)
  expect(html).not.toContain('Tish CRM')
  // Каждый тег — один раз: общие из index.html заменены, а не продублированы
  expect(content(html, 'og:title')).toEqual([page.ogTitle])
  expect(content(html, 'og:description')).toEqual([page.description])
  expect(content(html, 'description')).toEqual([page.description])
  expect(content(html, 'og:url')).toEqual([page.url])
  expect(content(html, 'og:image')).toEqual(['https://tish.kg/about/og-about.jpg'])
  expect(content(html, 'og:image:width')).toEqual(['1200'])
  expect(content(html, 'og:image:height')).toEqual(['630'])
  expect(content(html, 'og:locale')).toEqual(['ru_RU'])
  expect(content(html, 'twitter:card')).toEqual(['summary_large_image'])
  // Тот же SPA: скрипт-бандл, стили, метка версии и Telegram — без изменений
  for (const line of ['<script type="module" crossorigin src="/assets/main-AbC123.js"></script>', '<link rel="stylesheet" crossorigin href="/assets/main-XyZ789.css">', '<meta name="tish-version" content="0123456789ab">', 'telegram-web-app.js', '<div id="root"></div>']) {
    expect(html).toContain(line)
  }
  // Без превью и title остальное совпадает с index.html строка в строку
  const strip = (h: string) => h.split('\n').filter((l) => !/<title>|<meta (name|property)="(description|og:|twitter:)/.test(l))
  expect(strip(html)).toEqual(strip(built))
})

test('адреса — /start, /login, /app; кавычки в тексте экранируются', () => {
  expect(SHARE_PAGES.map((p) => p.file)).toEqual(['start', 'login', 'app'])
  const html = sharePageHtml(built, { ...start, ogTitle: 'Tish "бесплатно" <b>' })
  expect(content(html, 'og:title')).toEqual(['Tish &quot;бесплатно&quot; &lt;b&gt;'])
})

test('без <title> в index.html — ошибка сборки, а не страница без превью', () => {
  expect(() => sharePageHtml('<html><head></head></html>', start)).toThrow(/title/)
})
