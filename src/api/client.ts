import createClient, { type Middleware } from 'openapi-fetch'

import { authHeaders } from '../lib/telegram'

import type { components, paths } from './schema'

/** Схемы ответов и запросов из контракта (docs/api/openapi.json бэкенда). */
export type Schemas = components['schemas']

/**
 * Ошибка API в формате Problem Details: статус, текст для человека и ошибки полей (422).
 * 401 — сессия кончилась или не входили: экран входа.
 */
export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: Readonly<Record<string, string>>
  /** Тело Problem Details целиком: у 409 там code ('time-taken', 'stale', 'duplicate-patient') и данные. */
  readonly problem: Readonly<Record<string, unknown>>

  constructor(status: number, detail: string, fieldErrors: Record<string, string> = {}, problem: Record<string, unknown> = {}) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
    this.problem = problem
  }

  get code(): string | undefined {
    return typeof this.problem.code === 'string' ? this.problem.code : undefined
  }
}

/**
 * Защита от CSRF у сайта бэкенда: меняющий запрос с cookie-сессией сервер примет, только если
 * есть заголовок X-Dental-Web — чужая страница поставить его не может (браузер не пустит без CORS).
 */
const webHeader: Middleware = {
  onRequest({ request }) {
    request.headers.set('X-Dental-Web', '1')
    // В Telegram — подпись initData вместо cookie (ADR 0002)
    for (const [name, value] of Object.entries(authHeaders())) request.headers.set(name, value)
    return request
  },
}

/**
 * Типизированный клиент: пути, параметры и тела проверяет TypeScript по контракту. Адрес — тот
 * же origin: на проде nginx, на ноутбуке прокси Vite (vite.config.ts).
 */
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: 'same-origin',
  // fetch — в момент запроса: так его подменяет MSW в тестах
  fetch: (request) => globalThis.fetch(request),
})
api.use(webHeader)

function toApiError(status: number, body: unknown): ApiError {
  const problem = (typeof body === 'object' && body !== null ? body : {}) as {
    detail?: unknown
    errors?: { field?: unknown; message?: unknown }[]
  }
  const fieldErrors: Record<string, string> = {}
  for (const error of problem.errors ?? []) {
    if (typeof error.field === 'string' && typeof error.message === 'string') {
      fieldErrors[error.field] ??= error.message
    }
  }
  const detail = typeof problem.detail === 'string' ? problem.detail : `Ошибка сервера (${status})`
  return new ApiError(status, detail, fieldErrors, problem as Record<string, unknown>)
}

/** Данные ответа или {@link ApiError}: компоненты работают только с удачным результатом. */
export async function unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await request
  if (!response.ok) {
    throw toApiError(response.status, error)
  }
  return data as T
}

/**
 * Загрузка файла (multipart): openapi-fetch шлёт JSON, а снимку нужна форма. Тот же заголовок
 * X-Dental-Web и те же ошибки ApiError, что у {@link api}.
 */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await globalThis.fetch(new Request(new URL(path, window.location.origin), {
    method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-Dental-Web': '1', ...authHeaders() },
  }))
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw toApiError(response.status, body)
  }
  return body as T
}

/** Картинка с сервера (снимок пациента) — с заголовком сайта; в <img> — через URL.createObjectURL. */
export async function fetchBlob(path: string): Promise<Blob> {
  const response = await globalThis.fetch(new Request(new URL(path, window.location.origin), {
    credentials: 'same-origin', headers: { 'X-Dental-Web': '1', ...authHeaders() },
  }))
  if (!response.ok) {
    throw toApiError(response.status, await response.json().catch(() => null))
  }
  return response.blob()
}

/**
 * Имя бота клиники — для ссылок-приглашений (t.me/<бот>?start=…). /web/config — не часть
 * REST-контракта /api (его отдаёт вход сайта), поэтому тип — здесь, а не из schema.d.ts.
 */
/**
 * Вход на сайт: бот (имя и числовой id — окно входа Telegram.Login.auth) и включён ли вход по SMS
 * (smsLogin). null — не настроено ни то, ни другое.
 */
export async function botConfig(): Promise<{ username: string; id: number | null; smsLogin: boolean } | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { botUsername?: string | null; botId?: number | null; smsLogin?: boolean } | null
  // Для окна входа хватит id: имя бота (getMe) может временно не прийти, если Telegram не ответил
  return body?.botUsername || body?.botId || body?.smsLogin
    ? { username: body.botUsername ?? '', id: body.botId ?? null, smsLogin: body.smsLogin === true }
    : null
}

/** POST на адрес входа /web/… (вне контракта /api): с заголовком сайта; ошибка — {@link ApiError}. */
async function webPost(path: string, body: unknown): Promise<void> {
  const response = await globalThis.fetch(new Request(new URL(path, window.location.origin), {
    method: 'POST', credentials: 'same-origin', headers: { 'X-Dental-Web': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  if (!response.ok) throw toApiError(response.status, await response.json().catch(() => null))
}

/**
 * Вход без Telegram, шаг 1: прислать SMS-код. Сервер всегда отвечает «ок» — не говорит, есть ли
 * такой сотрудник; 503 — SMS не подключены, 422 — номер не похож на номер. Номер — только в теле.
 */
export function requestSmsCode(phone: string): Promise<void> {
  return webPost('/web/login/phone/code', { phone })
}

/** Шаг 2: номер и код → cookie-сессия, как после входа через Telegram. Неверный код — 401. */
export function phoneLogin(phone: string, code: string): Promise<void> {
  return webPost('/web/login/phone', { phone, code })
}

export async function botUsername(): Promise<string | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { botUsername?: string | null } | null
  return body?.botUsername ?? null
}

/** Выйти на сайте: сервер гасит cookie-сессию — снова экран входа. В Telegram выходить не из чего. */
export async function logout(): Promise<void> {
  await forgetPushSubscription()
  await globalThis.fetch(new Request(new URL('/web/logout', window.location.origin), {
    method: 'POST', credentials: 'same-origin', headers: { 'X-Dental-Web': '1' },
  })).catch(() => null)
  window.location.reload()
}

/**
 * Уведомления этого браузера — не следующему, кто войдёт на общем компьютере регистратуры:
 * при выходе подписку убираем и на сервере, и в браузере. Не вышло — не мешает выйти.
 */
async function forgetPushSubscription(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const subscription = await registration?.pushManager?.getSubscription()
    if (!subscription) return
    await globalThis.fetch(new Request(new URL('/api/push/unsubscribe', window.location.origin), {
      method: 'POST', credentials: 'same-origin', headers: { 'X-Dental-Web': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }))
    await subscription.unsubscribe()
  } catch {
    // нет service worker или сети — выходим всё равно
  }
}

/** Тарифы, как их видят клиники на /join. /web/tariffs — не часть контракта /api; форма — Tariffs. */
export async function webTariffs(): Promise<Schemas['Tariffs'] | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/tariffs', window.location.origin), { credentials: 'same-origin' }))
  return response.ok ? (await response.json()) as Schemas['Tariffs'] : null
}

/**
 * Статичный JSON сайта (например, /content/plan.json — готовый контент-план из сборки фронта): не
 * API, без заголовков входа. Нет файла (404) — null; не JSON — ApiError.
 */
export async function staticJson(path: string): Promise<unknown> {
  const response = await globalThis.fetch(new Request(new URL(path, window.location.origin), { credentials: 'same-origin', cache: 'no-cache' }))
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(response.status, `Файл ${path} не открылся (${response.status})`)
  try {
    return await response.json() as unknown
  } catch {
    throw new ApiError(response.status, `Файл ${path} — не JSON`)
  }
}
