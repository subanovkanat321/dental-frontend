import createClient, { type Middleware } from 'openapi-fetch'

import { authHeaders, telegram } from '../lib/telegram'

import type { components, paths } from './schema'
import { setUpdating } from './updating'

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
  // fetch — в момент запроса: так его подменяет MSW в тестах. Режим кэша — по умолчанию (не 'no-store'): опросы раз в
  // минуту (расписание, окна, счётчики) браузер сам переспрашивает с If-None-Match, и сервер отвечает 304 без тела, если
  // ничего не поменялось (бэкенд: ops.internal.PollingEtagFilter, Cache-Control: private, no-cache)
  fetch: (request) => send(request),
})
api.use(webHeader)

/** Код ошибки «Tish обновляется» (ApiError 503): сервер перезапускается, а интернет у человека есть. */
export const UPDATING = 'updating'

/** Текст ошибки «обновляется»: чтение React Query повторит сам, а действие — повторить руками. */
export const UPDATING_READ_TEXT = 'Tish обновляется — подождите минуту, всё продолжится само'
export const UPDATING_ACTION_TEXT = 'Tish обновляется — подождите минуту и повторите'

/** Ошибка «Tish обновляется» — сервер вот-вот вернётся (повторять запросы, показывать плашку). */
export function isUpdatingError(e: unknown): boolean {
  return e instanceof ApiError && e.code === UPDATING
}

/** Через сколько секунд сервер советует повторить (Retry-After от nginx); не сказал — null. */
export function retryAfterSeconds(e: unknown): number | null {
  const value = e instanceof ApiError ? e.problem.retryAfter : undefined
  return typeof value === 'number' && value > 0 ? value : null
}

/**
 * Ответ «приложение обновляется», а не ошибка самого приложения: nginx на 502/504 от приложения отдаёт
 * 503 с Retry-After (@app_unavailable); 502/503/504 без JSON — страница ошибки прокси. 502 и 503
 * приложения (Telegram не ответил, SMS не подключены) — JSON без Retry-After: это обычная ошибка.
 */
function isUpdatingResponse(response: Response): boolean {
  if (response.status !== 502 && response.status !== 503 && response.status !== 504) return false
  if (response.status === 503 && response.headers.has('Retry-After')) return true
  return !/json/i.test(response.headers.get('Content-Type') ?? '')
}

function updatingError(request: Request, retryAfter: string | null): ApiError {
  const seconds = Number(retryAfter)
  const text = request.method === 'GET' ? UPDATING_READ_TEXT : UPDATING_ACTION_TEXT
  return new ApiError(503, text, {}, { code: UPDATING, ...(seconds > 0 && { retryAfter: seconds }) })
}

/**
 * fetch, у которого обрыв сети — тоже {@link ApiError}, а не голый TypeError «Failed to fetch»:
 * экраны показывают e.message и e.fieldErrors любой ошибки запроса — у TypeError fieldErrors нет, и
 * Object.values(undefined) ронял карточку приёма на телефоне с плохой связью. Отмену запроса
 * (AbortError — React Query отменил устаревший) пропускаем как есть.
 * - Браузер без сети (navigator.onLine false) — ApiError 0 «Нет связи… проверьте интернет».
 * - Сеть есть, а сервер не ответил или ответил «обновляется» — ApiError 503 с кодом {@link UPDATING}
 *   и флаг «обновляется» (api/updating.ts): плашка вместо ошибки, чтения повторяются сами.
 * - Любой другой ответ — сервер на месте: флаг снят.
 */
async function send(request: Request): Promise<Response> {
  let response: Response
  try {
    response = await globalThis.fetch(request)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (navigator.onLine === false) throw new ApiError(0, 'Нет связи с сервером — проверьте интернет и повторите')
    setUpdating(true)
    throw updatingError(request, null)
  }
  if (isUpdatingResponse(response)) {
    setUpdating(true)
    throw updatingError(request, response.headers.get('Retry-After'))
  }
  setUpdating(false)
  return response
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
 * Настройки входа на сайт (GET /web/config) — один запрос и один ключ кэша на всё приложение: экран входа
 * (loginConfig) и ссылки-приглашения (botUsername — имя бота для t.me/<бот>?start=…). Ошибка — null.
 */
export type WebConfig = Schemas['WebAuthControllerConfig']

export const WEB_CONFIG_KEY = ['web-config'] as const

export async function webConfig(): Promise<WebConfig | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/config', window.location.origin), { credentials: 'same-origin' }))
  if (!response.ok) return null
  return await response.json().catch(() => null) as WebConfig | null
}

/** Имя бота из настроек входа — для ссылок t.me/<бот>?start=…; бот не настроен — null. */
export const botUsername = (config: WebConfig | null): string | null => config?.botUsername ?? null

/**
 * Вход на сайт (решение владельца 2026-11-27): «Войти через Telegram» (telegramLogin) и «Логин или телефон» + «Пароль»
 * (passwordLogin); «Забыли пароль?» — код в Telegram (telegramCode) или на почту (mailCode). SMS и Google убраны. null —
 * вход на сайт не настроен (нет токена бота).
 */
export function loginConfig(config: WebConfig | null | undefined): WebConfig | null {
  return config?.passwordLogin ? config : null
}

/**
 * POST на адрес входа /web/…: с заголовком сайта; ошибка — {@link ApiError}.
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
export type SetupToken = Schemas['PhoneLoginControllerSetupToken']

/** Как прислать код: «auto» — в Telegram (если номер к нему привязан и бот доставил); «mail» — на почту из «Моего профиля». */
export type CodeChannel = 'auto' | 'mail'

/**
 * «Забыли пароль? / Первый вход», шаг 1: прислать код. login — «Логин, телефон или почта» (номер — в виде для
 * запроса, phoneFromInput): есть «@» — почта (письмо только на неё, канал не важен), есть латинская буква — логин, иначе
 * номер. Сервер всегда отвечает «ок» — не говорит, есть ли такой сотрудник или почта, привязан ли номер к Telegram и
 * куда ушёл код; 503 — почта не подключена; 422 — не похоже ни на номер, ни на почту. Всё — только в теле.
 */
export async function requestLoginCode(login: string, channel: CodeChannel = 'auto'): Promise<void> {
  // Пусто (страницу перезагрузили на шаге кода) — сервер берёт своё из cookie «ждём код»
  const body = login ? { login } : {}
  await webPost('/web/login/phone/code', channel === 'auto' ? body : { ...body, channel })
}

/**
 * Шаг 2: логин, номер или почта (то же, что на шаге 1) и код → пропуск «Придумайте пароль» (ещё не вход). Неверный код — 401.
 * Пусто (страницу перезагрузили) — сервер берёт своё из HttpOnly-cookie «ждём код»; она истекла — 401 «Время на ввод кода вышло».
 */
export async function phoneLogin(login: string, code: string): Promise<SetupToken> {
  const token = await webPost<SetupToken>('/web/login/phone', login ? { login, code } : { code })
  if (!token?.setupToken) throw new ApiError(500, 'Вход не удался — попробуйте ещё раз')
  return token
}

/**
 * Вход «логин или телефон + пароль» (V264 бэкенда). login — логин (есть латинская буква) или номер в виде для запроса
 * (phoneFromInput). null — вошли (cookie-сессия); пропуск — пароль был временный, придумать свой.
 * Неверный логин/номер/пароль или пароля нет — 401 (одинаково: сервер не говорит, есть ли такой логин или номер);
 * 429 — блок 15 минут; 409 phone-orphan — пароль верный, но клинику удалили: текст сервера «Войдите через Telegram или
 * зарегистрируйте клинику». Логин и пароль — только в теле запроса.
 */
export function passwordLogin(login: string, password: string): Promise<SetupToken | null> {
  return webPost<SetupToken>('/web/login/phone/password', { login, password })
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
export type LoginPending = Schemas['PhoneLoginControllerPending']

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
 * HttpOnly-cookie, которая привязывает вход к этому браузеру.
 */
export type TelegramLoginStarted = Schemas['TelegramLoginControllerStarted']

/**
 * Как дела у входа через Telegram: none — не ждём (нет, истёк, уже вошли); waiting — ждём «Подтвердить вход»
 * в боте (link — та же ссылка, после перезагрузки страницы); cancelled — в боте нажали «Нет»; done — вошли,
 * cookie-сессия уже в ответе.
 */
export type TelegramLoginStatus = Schemas['TelegramLoginControllerStatus']

/** Начать вход через Telegram. 429 — много попыток с адреса, 503 — вход через Telegram не настроен. */
export async function startTelegramLogin(): Promise<TelegramLoginStarted> {
  const started = await webPost<TelegramLoginStarted>('/web/login/telegram/start', undefined)
  if (!started?.link) throw new ApiError(500, 'Сервер не ответил — попробуйте ещё раз')
  return started
}

/** Опрос входа через Telegram (раз в 2 секунды и при открытии экрана входа). */
export async function telegramLoginStatus(): Promise<TelegramLoginStatus> {
  return await webRequest<TelegramLoginStatus>('GET', '/web/login/telegram/status') ?? { state: 'none', secondsLeft: 0 }
}

/** «Отмена»: сервер забывает вход и гасит cookie. */
export async function forgetTelegramLogin(): Promise<void> {
  await webRequest('DELETE', '/web/login/telegram')
}

/**
 * Ссылка-приглашение на сайт (/invite#join_… врачу, /invite#staff_… сотруднику): что за приглашение.
 * kind — DOCTOR или STAFF; botUsername — для
 * «Открыть в Telegram», бот не настроен — null.
 */
export type InviteInfo = Schemas['InviteControllerInviteView']

/** Код ссылки — только в теле: 404 — ссылка недействительна или истекла, 429 — много неверных кодов. */
export async function inviteInfo(token: string): Promise<InviteInfo> {
  const info = await webPost<InviteInfo>('/web/invite', { token })
  if (!info) throw new ApiError(500, 'Сервер не ответил — обновите страницу')
  return info
}

/**
 * «Без Telegram — по номеру телефона» → врач или сотрудник, сразу вход (cookie): номер и пароль (кода из SMS нет —
 * убран 2026-11-27). 422 — поле phone или password; 409 — номер занят (code 'phone-taken'); 404 — ссылка не действует.
 * Номер и пароль — только в теле, нигде не сохраняем.
 */
export async function inviteRegister(token: string, fields: { phone: string; password: string }):
Promise<Schemas['InviteControllerRegistered']> {
  const done = await webPost<Schemas['InviteControllerRegistered']>('/web/invite/register', { token, ...fields })
  return done ?? { fullName: '', roleText: '' }
}

/**
 * Регистрация клиники на сайте (/start): какие способы подтверждения включены — кнопка в Telegram и письмо на почту.
 */
export type SignupAvailability = Schemas['SignupControllerAvailability']

/** Форма регистрации клиники (номер — как набран; проверяет и нормализует сервер). */
export type SignupForm = Pick<Schemas['SignupControllerSignupRequest'],
  'clinicName' | 'city' | 'fullName' | 'phone' | 'consent' | 'ref' | 'from' | 'leadId' | 'address'>

/** Клиника из списка 2ГИС в «Найдите свою клинику» (/start): название, город, короткий адрес — без телефонов. */
export type SignupClinic = Schemas['ClinicLeadsMatch']

/**
 * «Найдите свою клинику»: до 8 клиник по названию или адресу (от 3 букв, латиница и кириллица). 422 — меньше 3 букв,
 * 429 — слишком часто с этого адреса. Запрос — в адресе (это название клиники, не личные данные).
 */
export async function signupClinics(q: string): Promise<SignupClinic[]> {
  return await webRequest<SignupClinic[]>('GET', '/web/signup/clinics?q=' + encodeURIComponent(q)) ?? []
}

/**
 * Личная ссылка из сообщения клинике (/start?k=<код>): какая клиника — те же поля, что в поиске. Код — в теле, не в
 * адресе запроса. 404 (код не найден) — null: страница покажет обычный поиск; 429 и прочее — ошибка.
 */
export async function signupInvitedClinic(token: string): Promise<SignupClinic | null> {
  try {
    return await webRequest<SignupClinic>('POST', '/web/signup/lead', { token })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export type SignupTelegramStatus = Schemas['SignupControllerTelegramStatus']

export type SignupDone = Schemas['SignupControllerRegistered']

export async function signupAvailability(): Promise<SignupAvailability> {
  return await webRequest<SignupAvailability>('GET', '/web/signup') ?? { telegram: false, email: false }
}

/** «Подтвердить через Telegram»: та же проверка формы, затем ссылка в бота (t.me/<бот>?start=websignup_…). */
export async function signupTelegram(form: SignupForm): Promise<Schemas['SignupControllerTelegramStarted']> {
  const started = await webPost<Schemas['SignupControllerTelegramStarted']>('/web/signup/telegram', form)
  if (!started?.link) throw new ApiError(500, 'Сервер не ответил — попробуйте ещё раз')
  return started
}

/**
 * Опрос подтверждения в Telegram: waiting — ждём «✅ Да, это я»; confirmed — клиника уже создана в боте, можно
 * войти ({@link signupEnterTelegram}); failed — не создали (причина в error); cancelled — «Нет» в боте.
 */
export async function signupTelegramStatus(): Promise<SignupTelegramStatus> {
  return await webRequest<SignupTelegramStatus>('GET', '/web/signup/telegram/status') ?? { state: 'none', secondsLeft: 0 }
}

/** «Изменить данные»: сервер забывает шаг (письмо или Telegram). */
export async function forgetSignup(): Promise<void> {
  await webRequest('DELETE', '/web/signup/pending')
}

/**
 * Создать клинику кодом из письма (код и пароль). В ответе — cookie-сессия: человек уже вошёл руководителем и врачом.
 * Номер, код и пароль — только в теле, нигде не сохраняем.
 */
export async function signupRegister(form: SignupForm, confirm: { method: 'EMAIL'; code: string; password: string }): Promise<SignupDone> {
  return await webPost<SignupDone>('/web/signup', { ...form, ...confirm }) ?? { clinicName: form.clinicName ?? '', fullName: form.fullName ?? '' }
}

export type SignupEmailSent = Schemas['SignupControllerEmailSent']

export type SignupLinkPreview = Schemas['SignupControllerLinkPreview']

/**
 * «Подтвердить по почте»: та же проверка формы (422 по полям, 422 email, 409 — номер уже в клинике), затем письмо со
 * ссылкой «Подтвердить и открыть Tish» и кодом; 429 — лимит писем, 503 — почта не настроена или письмо не ушло. Шаг
 * кода сервер помнит HttpOnly-cookie. Почта — только в теле.
 */
export async function signupEmailCode(form: SignupForm, email: string): Promise<SignupEmailSent> {
  const sent = await webPost<SignupEmailSent>('/web/signup/email/code', { ...form, email })
  if (!sent) throw new ApiError(500, 'Сервер не ответил — попробуйте ещё раз')
  return sent
}

/** Ссылка из письма (/start/confirm): жива ли и что создадим; 404 — устарела или уже использована. Токен — в теле. */
export async function signupEmailLink(token: string): Promise<SignupLinkPreview> {
  const preview = await webPost<SignupLinkPreview>('/web/signup/email/link', { token })
  if (!preview) throw new ApiError(500, 'Сервер не ответил — попробуйте ещё раз')
  return preview
}

/** «Создать клинику» на странице ссылки: пароль придумывают здесь. В ответе — cookie-сессия. */
export async function signupEmailConfirm(token: string, password: string): Promise<SignupDone> {
  return await webPost<SignupDone>('/web/signup/email/confirm', { token, password }) ?? { clinicName: '', fullName: '' }
}

export type SignupEmailWaiting = Schemas['SignupControllerEmailWaiting']

/** Страницу перезагрузили: ждёт ли форма кода из письма (по HttpOnly-cookie шага). */
export async function signupEmailStatus(): Promise<SignupEmailWaiting> {
  return await webRequest<SignupEmailWaiting>('GET', '/web/signup/email/status') ?? { state: 'none', secondsLeft: 0 }
}

export type TelegramConnectStatus = Schemas['TelegramConnectControllerConnectStatus']

/**
 * «📲 Подключить Telegram» (сотрудник без Telegram): ссылка в бота t.me/<бот>?start=tglink_… — бот спросит «Это вы?»;
 * 409 — Telegram уже есть, 503 — бот не настроен.
 */
export async function telegramConnectStart(): Promise<Schemas['TelegramConnectControllerConnectStarted']> {
  return unwrap(api.POST('/api/me/telegram-connect'))
}

/** Ждём «✅ Да, это я»: linked — подключён, сервер выдал новую cookie-сессию (прежняя больше не действует). */
export async function telegramConnectStatus(): Promise<TelegramConnectStatus> {
  return await webRequest<TelegramConnectStatus>('GET', '/web/telegram-connect/status') ?? { state: 'none', secondsLeft: 0 }
}

/**
 * Через Telegram клиника создаётся в боте по «✅ Да, это я» (регистрация там и завершается). Вернулся на страницу —
 * войти в неё: форма не нужна, сервер узнаёт шаг по HttpOnly-cookie и отдаёт сессию один раз.
 */
export async function signupEnterTelegram(): Promise<SignupDone> {
  return await webPost<SignupDone>('/web/signup', { method: 'TELEGRAM' }) ?? { clinicName: '', fullName: '' }
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

/** Тарифы, как их видят клиники на /join (GET /web/tariffs). */
export async function webTariffs(): Promise<Schemas['Tariffs'] | null> {
  const response = await globalThis.fetch(new Request(new URL('/web/tariffs', window.location.origin), { credentials: 'same-origin' }))
  return response.ok ? (await response.json()) as Schemas['Tariffs'] : null
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
