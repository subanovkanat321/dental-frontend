/**
 * CRM внутри Telegram (ADR 0002 бэкенда): та же CRM открывается из бота как Mini App. Тогда вход —
 * подписанная Telegram строка initData (заголовок `Authorization: tma …`, как у старого Mini App),
 * а не cookie сайта. SDK — официальный telegram-web-app.js из index.html; вне Telegram initData пуста.
 */
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
  requestContact?(callback: (shared: boolean) => void): void
  ready(): void
  expand(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  BackButton?: BackButton
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp }
  }
}

/** Telegram Mini App, если CRM открыта из бота; иначе null (браузер, тесты). */
export function telegram(): WebApp | null {
  const app = window.Telegram?.WebApp
  return app && app.initData ? app : null
}

/** Заголовок входа для запросов: в Telegram — подпись initData, в браузере — ничего (cookie). */
export function authHeaders(): Record<string, string> {
  const app = telegram()
  return app ? { Authorization: `tma ${app.initData}` } : {}
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
