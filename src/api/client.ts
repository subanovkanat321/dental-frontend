import createClient, { type Middleware } from 'openapi-fetch'

import { authHeaders, telegram } from '../lib/telegram'

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
  fetch: (request) => send(request),
})
api.use(webHeader)

/**
 * fetch, у которого обрыв сети — тоже {@link ApiError} (status 0), а не голый TypeError «Failed to fetch»:
 * экраны показывают e.message и e.fieldErrors любой ошибки запроса — у TypeError fieldErrors нет, и
 * Object.values(undefined) ронял карточку приёма на телефоне с плохой связью. Отмену запроса
 * (AbortError — React Query отменил устаревший) пропускаем как есть.
 */
async function send(request: Request): Promise<Response> {
  try {
    return await globalThis.fetch(request)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'Нет связи с сервером — проверьте интернет и повторите')
  }
}

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
  const response = await send(new Request(new URL(path, window.location.origin), {
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
  const response = await send(new Request(new URL(path, window.location.origin), {
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
/**
 * Настройки страницы входа (/web/config, вне контракта /api). Вход на сайт — только по номеру и паролю;
 * telegramCode — код в Telegram (бот настроен), smsLogin — SMS подключены. Кнопка «Получить код» одна: канал
 * выбирает сервер (сначала Telegram, иначе SMS); smsLogin — показать «Не пришло? Отправить по SMS».
 * null — вход на сайт не настроен (нет токена бота).
 */
export type LoginConfig = {
  username: string; smsLogin: boolean; passwordLogin: boolean; telegramCode: boolean
  /** «Войти через Telegram» — ссылка в бота и «Подтвердить вход» там (TelegramLoginController бэкенда) */
  telegramLogin: boolean
}

export async function botConfig(): Promise<LoginConfig | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as
    { botUsername?: string | null; smsLogin?: boolean; passwordLogin?: boolean; telegramCode?: boolean; telegramLogin?: boolean } | null
  return body?.passwordLogin || body?.smsLogin
    ? { username: body.botUsername ?? '', smsLogin: body.smsLogin === true, passwordLogin: body.passwordLogin === true,
        telegramCode: body.telegramCode === true, telegramLogin: body.telegramLogin === true }
    : null
}

/**
 * POST на адрес входа /web/… (вне контракта /api): с заголовком сайта; ошибка — {@link ApiError}.
 * Ответ 204 — null, с телом — его JSON.
 */
async function webPost<T = void>(path: string, body: unknown): Promise<T | null> {
  return webRequest<T>('POST', path, body)
}

async function webRequest<T = void>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  const response = await send(new Request(new URL(path, window.location.origin), {
    method, credentials: 'same-origin',
    headers: body === undefined ? { 'X-Dental-Web': '1' } : { 'X-Dental-Web': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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
 * Как прислать код: «auto» — канал выбирает сервер (Telegram, если номер к нему привязан и бот доставил,
 * иначе SMS); «sms» — сразу SMS («Не пришло? Отправить по SMS»).
 */
export type CodeChannel = 'auto' | 'sms'

/**
 * «Забыли пароль? / Первый вход», шаг 1: прислать код. Сервер всегда отвечает «ок» — не говорит, есть
 * ли такой сотрудник, привязан ли номер к Telegram и куда ушёл код; 503 — явный SMS, а SMS не подключены;
 * 422 — номер не похож на номер. Номер — только в теле.
 */
export async function requestLoginCode(phone: string, channel: CodeChannel = 'auto'): Promise<void> {
  // Без номера (страницу перезагрузили на шаге кода) — сервер берёт номер из своей cookie «ждём код»
  const body = phone ? { phone } : {}
  await webPost('/web/login/phone/code', channel === 'sms' ? { ...body, channel } : body)
}

/**
 * Шаг 2: номер и код → пропуск «Придумайте пароль» (ещё не вход). Неверный код — 401. Номера нет (страницу
 * перезагрузили) — сервер берёт его из HttpOnly-cookie «ждём код»; она истекла — 401 «Время на ввод кода вышло».
 */
export async function phoneLogin(phone: string, code: string): Promise<SetupToken> {
  const token = await webPost<SetupToken>('/web/login/phone', phone ? { phone, code } : { code })
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
  // Без пропуска (страницу перезагрузили) — он в HttpOnly-cookie шага, сервер возьмёт его оттуда
  await webPost('/web/login/phone/password/new', token ? { token, password } : { password })
}

/**
 * Незаконченный вход после перезагрузки страницы (iOS выгружает вкладку, пока человек копирует код в
 * Telegram). Сам шаг помнит сервер — в HttpOnly-cookie: номер там зашифрован, скрипту страницы недоступен.
 * Номер в ответе — только маской. step «code» — ввести код, «password» — придумать пароль.
 */
export type LoginPending = {
  step: 'code' | 'password'; phoneMasked: string; secondsLeft: number; resendSeconds: number; temporary: boolean
}

/** На каком шаге продолжить вход; ничего не ждём или ошибка — null (тогда обычный экран входа). */
export async function loginPending(): Promise<LoginPending | null> {
  try {
    return await webRequest<LoginPending>('GET', '/web/login/phone/pending')
  } catch {
    return null
  }
}

/** «Другой номер»: сервер гасит cookie незаконченного входа. */
export async function forgetLoginPending(): Promise<void> {
  await webRequest('DELETE', '/web/login/phone/pending')
}

/**
 * «Войти через Telegram»: сервер дал одноразовую ссылку в бота (t.me/<бот>?start=weblogin_…) и поставил
 * HttpOnly-cookie, которая привязывает вход к этому браузеру. Адреса вне контракта /api — типы здесь.
 */
export type TelegramLoginStarted = { link: string; secondsLeft: number }

/**
 * Как дела у входа через Telegram: none — не ждём (нет, истёк, уже вошли); waiting — ждём «Подтвердить вход»
 * в боте (link — та же ссылка, после перезагрузки страницы); cancelled — в боте нажали «Нет»; done — вошли,
 * cookie-сессия уже в ответе.
 */
export type TelegramLoginStatus = { state: 'none' | 'waiting' | 'cancelled' | 'done'; secondsLeft: number; link: string | null }

/** Начать вход через Telegram. 429 — много попыток с адреса, 503 — вход через Telegram не настроен. */
export async function startTelegramLogin(): Promise<TelegramLoginStarted> {
  const started = await webPost<TelegramLoginStarted>('/web/login/telegram/start', undefined)
  if (!started?.link) throw new ApiError(500, 'Сервер не ответил — попробуйте ещё раз')
  return started
}

/** Опрос входа через Telegram (раз в 2 секунды и при открытии экрана входа). */
export async function telegramLoginStatus(): Promise<TelegramLoginStatus> {
  return await webRequest<TelegramLoginStatus>('GET', '/web/login/telegram/status') ?? { state: 'none', secondsLeft: 0, link: null }
}

/** «Отмена»: сервер забывает вход и гасит cookie. */
export async function forgetTelegramLogin(): Promise<void> {
  await webRequest('DELETE', '/web/login/telegram')
}

/**
 * Ссылка-приглашение на сайт (/invite#join_… врачу, /invite#staff_… сотруднику): что за приглашение.
 * Адрес вне контракта /api (как вход) — тип здесь. kind — DOCTOR или STAFF; botUsername — для
 * «Открыть в Telegram», бот не настроен — null. codeRequired — регистрация по номеру с кодом из SMS (SMS
 * на сервере подключены); false — номер и пароль без кода. pending — код по этой ссылке уже отправлен и ещё
 * действует (страницу перезагрузили): сразу шаг кода.
 */
export type InviteInfo = {
  kind: 'DOCTOR' | 'STAFF'; clinicName: string; fullName: string; role: string | null; roleText: string
  expiresAt: string; botUsername: string | null; codeRequired: boolean; pending: InviteCodeStep | null
}

/** Шаг «Код из SMS»: номер маской, сколько ещё действует код и через сколько можно отправить ещё раз (с). */
export type InviteCodeStep = { phoneMasked: string; secondsLeft: number; resendSeconds: number }

/** Код ссылки — только в теле: 404 — ссылка недействительна или истекла, 429 — много неверных кодов. */
export async function inviteInfo(token: string): Promise<InviteInfo> {
  const info = await webPost<InviteInfo>('/web/invite', { token })
  if (!info) throw new ApiError(500, 'Сервер не ответил — обновите страницу')
  return info
}

/**
 * «Получить код» по SMS для регистрации по ссылке. Сначала сервер проверяет номер: 409 — занят (SMS не
 * уходит), 422 — не номер, 404 — ссылка не действует; 429 — лимит SMS, 503 — SMS не отправилась. phone пусто —
 * «Отправить ещё раз» после перезагрузки: номер сервер берёт из своей HttpOnly-cookie.
 */
export async function inviteCode(token: string, phone: string): Promise<InviteCodeStep> {
  const step = await webPost<InviteCodeStep>('/web/invite/code', phone ? { token, phone } : { token })
  if (!step) throw new ApiError(500, 'Сервер не ответил — попробуйте ещё раз')
  return step
}

/** «Другой номер»: сервер гасит cookie шага кода. */
export async function forgetInviteCode(): Promise<void> {
  await webRequest('DELETE', '/web/invite/pending')
}

/**
 * «Без Telegram — по номеру телефона» → врач или сотрудник, сразу вход (cookie). С кодом (SMS подключены) —
 * код и пароль, номер сервер знает сам (cookie шага кода); без кода — номер и пароль. 422 — поле code, phone
 * или password; 409 — номер занят (code 'phone-taken'); 404 — ссылка не действует. Номер и пароль — только в
 * теле, нигде не сохраняем.
 */
export async function inviteRegister(token: string, fields: { phone?: string; code?: string; password: string }):
Promise<{ fullName: string; roleText: string }> {
  const done = await webPost<{ fullName: string; roleText: string }>('/web/invite/register', { token, ...fields })
  return done ?? { fullName: '', roleText: '' }
}

export async function botUsername(): Promise<string | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { botUsername?: string | null } | null
  return body?.botUsername ?? null
}

/**
 * Флаг «только что вышли» (sessionStorage этой вкладки, без личных данных): экран входа один раз
 * показывает подсказку про общий компьютер (layout/LoggedOutHint) и сразу его стирает.
 */
export const LOGGED_OUT = 'tish.loggedOut'

function markLoggedOut(): void {
  try {
    sessionStorage.setItem(LOGGED_OUT, '1')
  } catch {
    // хранилище закрыто (приватный режим) — подсказки просто не будет
  }
}

/**
 * Выйти на сайте: сервер гасит именно эту сессию (скопированная cookie больше не подойдёт) —
 * снова экран входа с подсказкой. В Telegram выходить не из чего.
 */
export async function logout(): Promise<void> {
  await forgetPushSubscription()
  await globalThis.fetch(new Request(new URL('/web/logout', window.location.origin), {
    method: 'POST', credentials: 'same-origin', headers: { 'X-Dental-Web': '1' },
  })).catch(() => null)
  markLoggedOut()
  window.location.reload()
}

/**
 * «Выйти на всех устройствах»: сервер гасит все входы этого человека на сайт (через Telegram и по
 * номеру), включая этот браузер. На сайте — экран входа с подсказкой; в Telegram Mini App сам вход
 * в Telegram остаётся, гаснут только входы на сайт.
 */
export async function logoutEverywhere(): Promise<void> {
  if (!telegram()) await forgetPushSubscription()
  await unwrap(api.POST('/api/me/logout-all'))
  if (telegram()) return
  markLoggedOut()
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

/** Кейс на /join («Как работает в клинике»): /web/case — не часть контракта /api; форма — JoinCaseCase. */
export async function webCase(): Promise<Schemas['JoinCaseCase'] | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/case', window.location.origin), { credentials: 'same-origin' }))
  return response.ok ? (await response.json()) as Schemas['JoinCaseCase'] : null
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
