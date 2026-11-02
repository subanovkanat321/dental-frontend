import { isIos, isStandalone } from './pwa'

/**
 * Уведомления в приложение (Web Push) со стороны браузера: поддержка, разрешение и подписка через
 * service worker (src/pwa/sw.js). Подписка — адрес push-сервиса браузера (Google, Apple, Mozilla)
 * и ключи шифрования; её получает бэкенд (POST /api/push/subscribe) и шлёт туда уведомления.
 * В localStorage ничего не кладём: подписку браузер хранит сам.
 */

/** ok — можно; ios-install — iPhone в Safari: push только у приложения с экрана «Домой»; unsupported — браузер не умеет. */
export type PushSupport = 'ok' | 'ios-install' | 'unsupported'

export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok'
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported'
}

export function permission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default'
}

/** Ключ сервера (base64url) → байты для applicationServerKey. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Service worker готов; не дождались (не зарегистрирован — сборка для разработки) — ошибка. */
async function registration(): Promise<ServiceWorkerRegistration> {
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('service worker не готов')), 8000)
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout])
  } finally {
    window.clearTimeout(timer)
  }
}

/** Подписка этого браузера, если есть (не спрашивает разрешения). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return (await reg?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

export type DeviceSubscription = { endpoint: string; p256dh: string; auth: string }

/**
 * Подписать этот браузер ключом сервера. Разрешение уже дано (Notification.requestPermission —
 * в обработчике нажатия, до этого вызова). Старая подписка другим ключом (на сервере сменили
 * ключи) — отписать и подписать заново.
 */
export async function subscribeThisDevice(publicKey: string): Promise<DeviceSubscription> {
  const reg = await registration()
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }
  let subscription: PushSubscription
  try {
    subscription = await reg.pushManager.subscribe(options)
  } catch (error) {
    const old = await reg.pushManager.getSubscription()
    if (!old) throw error
    await old.unsubscribe()
    subscription = await reg.pushManager.subscribe(options)
  }
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('браузер не дал ключи подписки')
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }
}
