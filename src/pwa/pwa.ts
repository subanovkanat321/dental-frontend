import { useSyncExternalStore } from 'react'

/**
 * CRM как приложение (PWA): установка на телефон/компьютер, service worker (src/pwa/sw.js) и
 * «Доступна новая версия». Внутри Telegram ничего из этого не нужно: Mini App открывает Telegram.
 */

/** Событие Chrome/Edge/Android «сайт можно установить» — его prompt() показывает окно установки. */
export type InstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Открыта как установленное приложение: отдельное окно без адресной строки. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone)
}

/** Запуск с иконки приложения: start_url манифеста — «/?source=pwa». */
export function launchedAsApp(search = window.location.search): boolean {
  return isStandalone() || new URLSearchParams(search).get('source') === 'pwa'
}

/** Внутри Telegram (Mini App): подпись запуска есть. Смотрим сам объект — SDK мог ещё не стартовать. */
function inTelegram(): boolean {
  return Boolean(window.Telegram?.WebApp?.initData)
}

/** iPhone и iPad (iPad с iPadOS 13 называет себя Mac, но у него есть тач). */
export function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Телефон или планшет — для подсказки на странице входа. */
export function isMobile(): boolean {
  return isIos() || /Android/i.test(navigator.userAgent)
}

// Маленькое общее состояние без библиотек: подписчики + снимок (useSyncExternalStore)
type State = { prompt: InstallPromptEvent | null; installed: boolean; waiting: ServiceWorker | null }
let state: State = { prompt: null, installed: false, waiting: null }
const listeners = new Set<() => void>()
function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePwa(): State {
  return useSyncExternalStore(subscribe, () => state)
}


let listening = false
/**
 * Ловим «можно установить» с самого старта (main.tsx): Chrome шлёт его один раз, обычно до того,
 * как сотрудник откроет «Настройки». Своё окно покажем по кнопке «Установить».
 */
export function listenInstallPrompt(): void {
  if (listening) return
  listening = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    set({ prompt: event as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => set({ prompt: null, installed: true }))
}

/** Окно установки браузера; согласились — «установлено». Повторно prompt() вызвать нельзя. */
export async function install(): Promise<boolean> {
  const prompt = state.prompt
  if (!prompt) return false
  await prompt.prompt()
  const choice = await prompt.userChoice
  set({ prompt: null, installed: choice.outcome === 'accepted' || state.installed })
  return choice.outcome === 'accepted'
}

let registered = false
let reloading = false

/**
 * Регистрация service worker: только в сборке (не в npm run dev и тестах), не в Telegram (там
 * приложение — Mini App, кэш Telegram свой) и где браузер умеет. Возвращает, зарегистрировали ли.
 */
export function registerServiceWorker(prod: boolean = import.meta.env.PROD): boolean {
  if (registered || !prod || inTelegram() || !('serviceWorker' in navigator)) return false
  registered = true
  const sw = navigator.serviceWorker
  // Новая версия заработала (нажали «Обновить») — перезагрузить один раз на новый код
  sw.addEventListener('controllerchange', () => {
    if (!reloading) return
    reloading = false
    window.location.reload()
  })
  sw.register('/sw.js', { scope: '/' }).then((registration) => {
    // Ждёт своей очереди — версия, скачанная в прошлый раз; controller — значит, это обновление,
    // а не самая первая установка
    const offer = (worker: ServiceWorker | null) => {
      if (worker && sw.controller) set({ waiting: worker })
    }
    offer(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer(worker)
      })
    })
    // Регистратура держит CRM открытой весь день: проверяем новую версию раз в полчаса и при
    // возвращении на вкладку (сам браузер проверяет только при переходах)
    const check = () => { registration.update().catch(() => {}) }
    window.setInterval(check, 30 * 60_000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  }).catch(() => {
    // Не зарегистрировался (приватный режим, старый браузер) — CRM работает и без него
  })
  return true
}

/** Только для тестов: начать с чистого состояния. */
export function resetPwa(patch: Partial<State> = {}): void {
  registered = false
  set({ prompt: null, installed: false, waiting: null, ...patch })
}

/** «Обновить»: новая версия начинает работать, страница перезагружается (controllerchange). */
export function applyUpdate(): void {
  const worker = state.waiting
  if (!worker) return
  reloading = true
  worker.postMessage({ type: 'SKIP_WAITING' })
}

/** «Позже» — скрыть до следующей новой версии. */
export function dismissUpdate(): void {
  set({ waiting: null })
}
