import { hasUnsaved } from '../lib/unsaved'
import { applyUpdate, hasWaitingUpdate } from './pwa'

/**
 * Тихое обновление на новую версию — во всех режимах: сайт, PWA и Telegram (там service worker не
 * регистрируется, и без этого люди сидели на старой версии, пока сами не закроют Mini App).
 *
 * Сборка кладёт в dist/version.json хеш сборки, а в index.html — тот же хеш в `<meta name="tish-version">`
 * (vite.config.ts, плагин tish-version). Приложение сверяет их при возвращении на вкладку и раз в
 * 10 минут (`cache: 'no-store'` — мимо кэша браузера). Вышла новая — перезагружаемся сами, но только в
 * безопасный момент: при смене раздела или после 5+ минут в фоне, и только если на экране ничего
 * не вводят (lib/unsaved, фокус в поле, открытая карточка или окно). Никогда — посреди ввода.
 * В dev и тестах мета нет — проверка выключена.
 */
const CHECK_EVERY_MS = 10 * 60_000
/** Столько в фоне — человек отошёл: вернулся — можно тихо перезагрузить. */
export const AWAY_MS = 5 * 60_000
const RELOADED_FOR = 'crm.reloadedForVersion'

let current: string | null = null
/** Версия на сервере, если она новее нашей. */
let latest: string | null = null
let hiddenAt: number | null = null
let timer: ReturnType<typeof setInterval> | undefined
let started = false
/** Разделы, которые ушли в фон с несохранённой формой: их правки ждут, перезагружать нельзя. */
const dirtySections = new Set<string>()

/** Версия этой сборки из index.html; нет (dev, тесты) — null. */
export function buildVersion(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="tish-version"]')?.content || null
}

/** Сверить с сервером. true — на сервере новая версия. Ошибка сети или не JSON (nginx отдал index.html) — молча нет. */
export async function checkVersion(): Promise<boolean> {
  if (!current) return false
  try {
    const response = await fetch(new URL('/version.json', window.location.origin), { cache: 'no-store' })
    if (response.ok) {
      const data: unknown = await response.json()
      const version = typeof data === 'object' && data !== null ? (data as { version?: unknown }).version : null
      if (typeof version === 'string' && version && version !== current) latest = version
    }
  } catch {
    // нет связи или не JSON — проверим в следующий раз
  }
  return latest != null
}

/**
 * Раздел уходит в фон (App, при смене раздела): были несохранённые правки — запомнить, что он «грязный».
 * Скрытый раздел свои формы в lib/unsaved не держит, поэтому помним здесь, пока не вернутся и не уйдут чистыми.
 */
export function noteSectionLeft(section: string, unsaved: boolean): void {
  if (unsaved) dirtySections.add(section)
  else dirtySections.delete(section)
}

/** Ничего не вводят: нет правок, фокус не в поле, не открыты карточка справа и окна (в любом разделе). */
export function quietScreen(): boolean {
  if (hasUnsaved() || dirtySections.size > 0) return false
  const el = document.activeElement
  if (el instanceof HTMLElement && (el.matches('input, textarea, select') || el.isContentEditable)) return false
  return document.querySelector('.with-panel, [role="dialog"], [aria-modal="true"]') == null
}

function reloadTo(version: string): void {
  try {
    // На эту версию уже перезагружались, а она снова «новая» (кэш где-то по дороге) — не крутимся
    if (sessionStorage.getItem(RELOADED_FOR) === version) return
    sessionStorage.setItem(RELOADED_FOR, version)
  } catch {
    // приватный режим — перезагрузимся без отметки
  }
  window.location.reload()
}

/**
 * Безопасный момент (смена раздела, возвращение после 5+ минут): есть новая версия и ничего не вводят —
 * обновиться. В PWA ждущий service worker включаем сами (он и перезагрузит), иначе — просто перезагрузка.
 */
export function updateAtSafeMoment(): void {
  if (!hasWaitingUpdate() && !latest) return
  if (!quietScreen()) return
  if (hasWaitingUpdate()) applyUpdate()
  else if (latest) reloadTo(latest)
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    return
  }
  const away = hiddenAt != null && Date.now() - hiddenAt > AWAY_MS
  hiddenAt = null
  void checkVersion().then(() => {
    if (away && document.visibilityState === 'visible') updateAtSafeMoment()
  })
}

/** Запуск (main.tsx), один раз: CRM, вход и Mini App пациента. */
export function startVersionCheck(): void {
  if (started) return
  current = buildVersion()
  if (!current) return
  started = true
  document.addEventListener('visibilitychange', onVisibility)
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void checkVersion()
  }, CHECK_EVERY_MS)
}

/** Только для тестов: начать с чистого состояния. */
export function resetVersionCheck(): void {
  document.removeEventListener('visibilitychange', onVisibility)
  clearInterval(timer)
  current = null
  latest = null
  hiddenAt = null
  started = false
  dirtySections.clear()
}
