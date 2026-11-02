/**
 * CRM внутри Telegram (ADR 0002 бэкенда): та же CRM открывается из бота как Mini App. Тогда вход —
 * подписанная Telegram строка initData (заголовок `Authorization: tma …`, как у старого Mini App),
 * а не cookie сайта. SDK — официальный telegram-web-app.js из index.html; вне Telegram initData пуста.
 */

import { isLoginPath } from './route'
type BackButton = { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }

type MainButton = {
  setText(text: string): void
  show(): void
  hide(): void
  enable(): void
  disable(): void
  showProgress(leaveActive?: boolean): void
  hideProgress(): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}

type WebApp = {
  initData: string
  initDataUnsafe?: { user?: { language_code?: string } }
  MainButton?: MainButton
  HapticFeedback?: { notificationOccurred(type: 'success' | 'warning' | 'error'): void }
  openLink?(url: string): void
  /** t.me-ссылка внутри Telegram (например, «поделиться»), без браузера */
  openTelegramLink?(url: string): void
  /** ios, android, tdesktop, macos, weba… — где открыт Mini App */
  platform?: string
  requestContact?(callback: (shared: boolean) => void): void
  /** Версия Bot API клиента не ниже: requestContact — с 6.9 */
  isVersionAtLeast?(version: string): boolean
  ready(): void
  expand(): void
  colorScheme?: string
  onEvent?(event: string, cb: () => void): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  BackButton?: BackButton
  /** Спросить «закрыть?», когда Mini App закрывают с несохранёнными правками (Bot API 6.2) */
  enableClosingConfirmation?(): void
  disableClosingConfirmation?(): void
}

/** Окно входа Telegram (скрипт telegram-widget.js): user — подписанные данные входа, false — закрыли окно. */
export type TelegramLogin = {
  auth(options: { bot_id: number; request_access?: 'write'; lang?: string }, callback: (user: Record<string, unknown> | false) => void): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp; Login?: TelegramLogin }
  }
}

/** Telegram Mini App, если CRM открыта из бота; иначе null (браузер, тесты). */
export function telegram(): WebApp | null {
  const app = window.Telegram?.WebApp
  return app && app.initData ? app : null
}

/** Подпись для входа на ноутбуке (`npm run dev`) — см. startDevLogin. */
let devInitData = ''

/** Заголовок входа для запросов: в Telegram — подпись initData, в браузере — ничего (cookie). */
export function authHeaders(): Record<string, string> {
  const initData = telegram()?.initData || devInitData
  return initData ? { Authorization: `tma ${initData}` } : {}
}

/**
 * Только `npm run dev`: вход без Telegram. Виджет «Войти через Telegram» на localhost не работает,
 * поэтому подпись берём у бэкенда — `/dev/init-data` есть лишь в его профиле local (на проде 404)
 * и подписывает первого из ALLOWED_TELEGRAM_IDS (по умолчанию 1 — админ клиники №1). Бэкенд не в
 * local — ответ не 200, остаётся обычный вход. В сборке (`npm run build`) этого кода нет: вызов —
 * под `import.meta.env.DEV`.
 */
export async function startDevLogin(): Promise<void> {
  if (telegram() || isLoginPath()) return
  try {
    const response = await fetch('/dev/init-data')
    if (response.ok) devInitData = (await response.text()).trim()
  } catch {
    // бэкенд не запущен — экран «Нет связи с сервером» скажет сам
  }
}

/** Сообщить Telegram, что CRM готова: на весь экран, шапка в цвет тёмного меню. */
export function startTelegram(): void {
  const app = telegram()
  if (!app) return
  app.ready()
  app.expand()
  app.setHeaderColor?.('#0F2A30')
  document.body.classList.add('in-telegram')
}

/** Внешняя ссылка: в Telegram — его браузером (Mini App не уходит со страницы), иначе — новая вкладка. */
export function openLink(url: string): void {
  const app = telegram()
  if (app?.openLink) app.openLink(url)
  else window.open(url, '_blank', 'noopener')
}

/** Лёгкая вибрация в Telegram: успех, предупреждение, ошибка. Вне Telegram — ничего. */
export function haptic(type: 'success' | 'warning' | 'error'): void {
  telegram()?.HapticFeedback?.notificationOccurred(type)
}
