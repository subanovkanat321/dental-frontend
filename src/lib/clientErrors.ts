import { reportClientError } from '../api/client'
import { isIos, isStandalone } from '../pwa/pwa'

/**
 * Ошибки приложения с настоящих телефонов — владельцу в бот (через сервер, POST /web/client-error).
 * Врач работает в Telegram на iPhone или в PWA на Android: то, что у нас в тестах не повторяется,
 * иначе узнаём, только когда он напишет. Ловим:
 * - необработанные исключения (window «error») и отклонённые промисы («unhandledrejection»);
 * - упавший экран — ErrorBoundary зовёт {@link reportError}.
 *
 * Не шлём: ошибки запросов (их видит сервер), шум браузера (ResizeObserver, расширения, «Script
 * error.» без подробностей, отменённые запросы), обрывы сети («Failed to fetch», «Load failed» —
 * сеть у врача пропадает в лифте, исправить мы это не можем; их только считаем) и старые куски кода
 * после обновления (ErrorBoundary перезагружает сам).
 *
 * Без данных пациентов: только текст ошибки и стек (сервер ещё вырезает из них номера, e-mail и
 * имена в кавычках), раздел из адреса без номеров и параметров, платформа и версия сборки. Ни
 * props, ни данных форм, ни хранилища. Не больше {@link MAX_PER_SESSION} отчётов за сессию вкладки,
 * одинаковые — один раз.
 */

export const MAX_PER_SESSION = 5

const SENT_KEY = 'crm.errorReports'

let started = false
let sentHere = 0
const seen = new Set<string>()
let offline = 0

/** Обрывов сети за сессию: их не шлём, только считаем (для отладки в консоли). */
export function networkErrors(): number {
  return offline
}

/** Для тестов: начать сессию заново. */
export function resetErrorReports(): void {
  sentHere = 0
  offline = 0
  seen.clear()
  try {
    sessionStorage.removeItem(SENT_KEY)
  } catch {
    // нет хранилища
  }
}

/** Слушать ошибки страницы — один раз за загрузку (main.tsx и страницы сайта). */
export function startErrorReports(): void {
  if (started) return
  started = true
  window.addEventListener('error', (event) => {
    // Ошибка загрузки картинки или скрипта — не исключение: у неё нет message
    if (!(event instanceof ErrorEvent)) return
    reportError(event.error ?? event.message, { filename: event.filename })
  })
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
}

const NOISE = /ResizeObserver loop|^Script error\.?$|dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i
const NETWORK = /Нет связи с сервером|Failed to fetch|Load failed|NetworkError when attempting|Network request failed|network error/i
const EXTENSION = /(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i

/** Отправить ошибку, если это не шум и лимит сессии не исчерпан. */
export function reportError(error: unknown, options: { filename?: string; component?: string } = {}): void {
  try {
    const { message, stack } = describe(error)
    if (!message && !stack) return
    if (isRequestError(error) || NOISE.test(message) || EXTENSION.test(`${options.filename ?? ''}\n${stack}`)) return
    if (isAbort(error, message)) return
    if (NETWORK.test(message)) {
      offline++
      return
    }
    const key = `${message}\n${stack.split('\n').find((line) => /:\d+/.test(line)) ?? ''}`
    if (seen.has(key)) return
    if (sentCount() >= MAX_PER_SESSION) return
    seen.add(key)
    countSent()
    const where = options.component ? `\n    in ${options.component}` : ''
    reportClientError({
      message: message.slice(0, 300),
      stack: (stack + where).slice(0, 2000),
      section: section(),
      appVersion: appVersion(),
      platform: platform(),
      userAgent: shortUserAgent(navigator.userAgent),
    })
  } catch {
    // отчёт об ошибке не должен ронять приложение
  }
}

/**
 * Текст и стек — только у Error или строки. Объект без Error (отклонили промис с данными ответа)
 * не превращаем в текст: внутри могут быть данные пациента — только его тип.
 */
function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    const text = error.message ? `${error.name}: ${error.message}` : error.name
    return { message: text, stack: error.stack ?? '' }
  }
  if (typeof error === 'string') return { message: error, stack: '' }
  if (error == null) return { message: '', stack: '' }
  const type = typeof error === 'object' ? (error.constructor?.name ?? 'Object') : typeof error
  return { message: `Отклонено без Error: ${type}`, stack: '' }
}

/** Ошибку запроса (ApiError) видит сервер — повторять её не надо. */
function isRequestError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ApiError'
}

function isAbort(error: unknown, message: string): boolean {
  return (error instanceof Error || error instanceof DOMException) && error.name === 'AbortError' || /aborted/i.test(message)
}

/** Отчётов за сессию вкладки: в sessionStorage — чтобы перезагрузка после «Обновить» не обнуляла лимит. */
function sentCount(): number {
  try {
    return Math.max(sentHere, Number(sessionStorage.getItem(SENT_KEY)) || 0)
  } catch {
    return sentHere
  }
}

function countSent(): void {
  sentHere = sentCount() + 1
  try {
    sessionStorage.setItem(SENT_KEY, String(sentHere))
  } catch {
    // приватный режим — считаем в памяти
  }
}

/**
 * Раздел из адреса — только слова, без номеров и кодов: «/#/settings/hours» → «settings/hours»,
 * «/c/abc123» → «c», «/» → «schedule». Ни параметров, ни фрагментов с данными.
 */
export function section(location: Pick<Location, 'pathname' | 'hash'> = window.location): string {
  const word = (s: string | undefined) => (s && /^[a-z-]{1,30}$/i.test(s) ? s.toLowerCase() : '')
  const path = word(location.pathname.split('/')[1])
  const hash = location.hash.replace(/^#\/?/, '').split(/[/?]/).slice(0, 2).map(word).filter(Boolean).join('/')
  if (path) return hash ? `${path}/${hash}` : path
  return hash || 'schedule'
}

/** Версия сборки — имя файла с кодом (в нём хеш): «index-B7x9k2.js». */
function appVersion(): string {
  try {
    return new URL(import.meta.url).pathname.split('/').pop()?.slice(0, 40) ?? ''
  } catch {
    return ''
  }
}

/** Где открыто: tg-ios, tg-android, tg-desktop, pwa-ios, browser-android… */
export function platform(): string {
  const os = isIos() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop'
  const app = window.Telegram?.WebApp
  if (app?.initData) {
    const p = app.platform ?? ''
    return `tg-${p === 'ios' || p === 'android' ? p : p ? 'desktop' : os}`
  }
  return `${isStandalone() ? 'pwa' : 'browser'}-${os}`
}

/** Коротко о браузере: «iPhone OS 17_4 · Safari 17», «Android 14 · Chrome 129». */
export function shortUserAgent(ua: string): string {
  // По порядку: в строке Android есть и «Linux», а в строке iPhone — «Mac OS X»
  const os = [/iPhone OS [\d_]+/, /CPU OS [\d_]+/, /Android [\d.]+/, /Windows NT [\d.]+/, /Mac OS X [\d_.]+/, /CrOS/, /Linux/]
    .map((re) => re.exec(ua)?.[0]).find(Boolean) ?? ''
  const browser = /(Telegram|YaBrowser|Edg|OPR|Firefox|CriOS|Chrome|Version)\/(\d+)/.exec(ua)
  const name = browser ? `${browser[1] === 'Version' ? 'Safari' : browser[1]} ${browser[2]}` : ''
  return [os, name].filter(Boolean).join(' · ').slice(0, 120)
}
