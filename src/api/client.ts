import createClient, { type Middleware } from 'openapi-fetch'

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

export function toApiError(status: number, body: unknown): ApiError {
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
