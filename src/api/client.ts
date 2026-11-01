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
export async function botUsername(): Promise<string | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { botUsername?: string | null } | null
  return body?.botUsername ?? null
}

/** Тарифы, как их видят клиники на /join. /web/tariffs — не часть контракта /api; форма — Tariffs. */
export async function webTariffs(): Promise<Schemas['Tariffs'] | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/tariffs', window.location.origin), { credentials: 'same-origin' }))
  return response.ok ? (await response.json()) as Schemas['Tariffs'] : null
}
