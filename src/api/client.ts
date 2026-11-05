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
 * Вход на сайт: бот (имя и числовой id — окно входа Telegram.Login.auth), включён ли вход по SMS
 * (smsLogin) и «номер + пароль» (passwordLogin — работает и без SMS). null — не настроено ничего.
 */
export async function botConfig(): Promise<{ username: string; id: number | null; smsLogin: boolean; passwordLogin: boolean } | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as
    { botUsername?: string | null; botId?: number | null; smsLogin?: boolean; passwordLogin?: boolean } | null
  // Для окна входа хватит id: имя бота (getMe) может временно не прийти, если Telegram не ответил
  return body?.botUsername || body?.botId || body?.smsLogin || body?.passwordLogin
    ? { username: body.botUsername ?? '', id: body.botId ?? null, smsLogin: body.smsLogin === true, passwordLogin: body.passwordLogin === true }
    : null
}

/**
 * POST на адрес входа /web/… (вне контракта /api): с заголовком сайта; ошибка — {@link ApiError}.
 * Ответ 204 — null, с телом — его JSON.
 */
async function webPost<T = void>(path: string, body: unknown): Promise<T | null> {
  const response = await globalThis.fetch(new Request(new URL(path, window.location.origin), {
    method: 'POST', credentials: 'same-origin', headers: { 'X-Dental-Web': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  if (!response.ok) throw toApiError(response.status, await response.json().catch(() => null))
  return response.status === 204 ? null : await response.json().catch(() => null) as T | null
}

/**
 * Пропуск «код подтверждён»: одноразовый, 10 минут — с ним задают пароль. temporary — вошли
 * временным паролем от админа. Пропуск держим только в памяти страницы, не в localStorage.
 */
export type SetupToken = { setupToken: string; temporary: boolean }

/**
 * Вход без Telegram, шаг 1: прислать SMS-код. Сервер всегда отвечает «ок» — не говорит, есть ли
 * такой сотрудник; 503 — SMS не подключены, 422 — номер не похож на номер. Номер — только в теле.
 */
export async function requestSmsCode(phone: string): Promise<void> {
  await webPost('/web/login/phone/code', { phone })
}

/** Шаг 2: номер и код → пропуск «Придумайте пароль» (ещё не вход). Неверный код — 401. */
export async function phoneLogin(phone: string, code: string): Promise<SetupToken> {
  const token = await webPost<SetupToken>('/web/login/phone', { phone, code })
  if (!token?.setupToken) throw new ApiError(500, 'Вход не удался — попробуйте ещё раз')
  return token
}

/**
 * Вход «номер + пароль». null — вошли (cookie-сессия); пропуск — пароль был временный, придумать свой.
 * Неверный номер/пароль или пароля нет — 401 (одинаково: сервер не говорит, есть ли номер); 429 — блок 15 минут.
 */
export function passwordLogin(phone: string, password: string): Promise<SetupToken | null> {
  return webPost<SetupToken>('/web/login/phone/password', { phone, password })
}

/** «Придумайте пароль»: пропуск + пароль → вход. Слабый пароль — 422 (поле password), пропуск устарел — 401. */
export async function setNewPassword(token: string, password: string): Promise<void> {
  await webPost('/web/login/phone/password/new', { token, password })
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

/** Отчёт об ошибке в приложении — без данных пациентов: текст, стек, раздел, где открыто. */
export type ClientErrorReport = {
  message: string
  stack: string
  section: string
  appVersion: string
  platform: string
  userAgent: string
}

/**
 * Ошибка в приложении → сервер → владельцу в бот (POST /web/client-error, бэкенд чистит текст от
 * номеров и имён). Не sendBeacon: он не умеет заголовки, а без X-Dental-Web сервер ответит 403.
 * keepalive — запрос доживёт, даже если страницу сейчас закроют или перезагрузят. Без входа (ошибка
 * бывает и до него) и без ответа: не дошло — и ладно, ошибка об ошибке никому не нужна.
 */
export function reportClientError(report: ClientErrorReport): void {
  try {
    void globalThis.fetch(new Request(new URL('/web/client-error', window.location.origin), {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'X-Dental-Web': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    })).catch(() => null)
  } catch {
    // нет fetch или Request — молчим
  }
}
