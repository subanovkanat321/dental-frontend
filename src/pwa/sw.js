/*
 * Service worker CRM (PWA): приложение ставится на телефон и компьютер «как программа».
 * Шаблон — сборка (vite.config.ts, плагин serviceWorker) кладёт его в dist/sw.js и подставляет
 * версию сборки: новая сборка — новый sw.js — браузер ставит новую версию, CRM показывает
 * «Доступна новая версия — Обновить» (src/pwa/UpdateToast.tsx).
 *
 * Что кэшируем:
 * - /assets/* — файлы сборки с хешем в имени (JS, CSS, шрифты): не меняются → «сначала кэш»;
 * - значки, манифест и страница «Нет интернета» — при установке;
 * - переходы по страницам — «сначала сеть»; сети нет — страница «Нет интернета».
 * Никогда не кэшируем: /api, /web, /telegram, /doctors (данные пациентов, вход), чужие сайты
 * (telegram.org) и запросы с заголовком входа — им браузер ходит в сеть как без service worker.
 */
const VERSION = '__SW_VERSION__'
const STATIC_CACHE = `tish-static-${VERSION}`
const ASSETS_CACHE = `tish-assets-${VERSION}`
const OFFLINE = '/offline.html'
const PRECACHE = [OFFLINE, '/manifest.webmanifest', '/tishka-icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']
const NEVER = /^\/(api|web|telegram|doctors|dev|actuator)(\/|$)/
const STATIC_FILE = /^\/[a-z0-9-]+\.(svg|png|webmanifest)$/

self.addEventListener('install', (event) => {
  // Без skipWaiting: новая версия ждёт, пока сотрудник сам нажмёт «Обновить» (сообщение ниже) —
  // не перезагружаем страницу посреди записи пациента
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))))
})

self.addEventListener('activate', (event) => {
  // Кэши прошлых версий — удалить: старые файлы сборки больше не нужны
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('tish-') && key !== STATIC_CACHE && key !== ASSETS_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return
  if (request.headers.has('Authorization')) return
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE))
    return
  }
  if (STATIC_FILE.test(url.pathname)) event.respondWith(cacheFirst(request, STATIC_CACHE))
})

/** Страница — всегда свежая из сети (новая сборка сразу); сети нет — «Нет интернета». */
async function networkFirst(request) {
  try {
    return await fetch(request)
  } catch {
    const offline = await caches.match(OFFLINE)
    return offline || Response.error()
  }
}

/** Файл с хешем в имени не меняется: есть в кэше — оттуда, нет — из сети и в кэш. */
async function cacheFirst(request, name) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  // Только удачный ответ своего сайта: 404 или index.html вместо файла в кэш не кладём
  const type = response.headers.get('Content-Type') || ''
  if (response.ok && response.type === 'basic' && !type.startsWith('text/html')) {
    const copy = response.clone()
    quietly(caches.open(name).then((cache) => cache.put(request, copy)))
  }
  return response
}

/** Запись в кэш не задерживает ответ; ошибка записи (место кончилось) — не ошибка запроса. */
function quietly(promise) {
  promise.catch(() => {})
}
