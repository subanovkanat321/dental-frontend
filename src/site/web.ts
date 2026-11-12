import { useEffect, useState } from 'react'

import type { Schemas } from '../api/client'

/**
 * Ответы открытых адресов /web/* (страницы сайта без входа) — из контракта docs/api/openapi.json, как и /api.
 * ClinicPage: phones — номера для звонка (первый — главный), whatsapp — свой номер или null: тогда кнопки
 * WhatsApp нет; settingUp — новая клиника ещё настраивается (V95): записи нет, telegramUrl пуст; bookingUrl —
 * запись на сайте без Telegram (/c/<код>#book), null — самозапись выключена или клиника настраивается.
 */
export type ClinicPage = Schemas['ClinicPageControllerPage']
export type SiteDoctor = Schemas['ClinicPageControllerDoctor']

/** city — город из списка (V121), по нему фильтр «по городам»; null — не указан. */
export type DirectoryClinic = Schemas['DirectoryControllerClinic']

/**
 * Запись на сайте без Telegram (GET /web/booking?code=). available — можно записаться; нет — unavailable:
 * off, setting-up или paused (тогда «позвоните»). telegramUrl — мягкая подсказка «там бот напомнит»,
 * whatsapp — «Удобнее в WhatsApp?».
 */
export type WebBookingInfo = Schemas['WebBookingServiceInfo']

/** Заявка принята: что показать на экране «Заявка отправлена» (whatsapp — готовый текст без имени и телефона). */
export type WebBooked = Schemas['WebBookingServiceBooked']

/** Ответ-ошибка открытого адреса (Problem Details): code — для своих слов, errors — под полями. */
export type SiteProblem = { code?: string; detail?: string; errors?: { field: string; message: string }[] }

/** Контакты платформы: supportPhones — телефоны по порядку, supportWhatsapp — свой номер или null. */
export type Links = Schemas['LinksControllerLinks']

export type Tariffs = Schemas['Tariffs']
/**
 * Ролик и презентация для /join (/web/materials/public, файлы бэкенд отдаёт из MARKETING_DIR).
 * null — файла нет (каталог не подключён), блок не показываем.
 */
export type PublicMaterials = Schemas['MaterialsPublicMaterials']
/** Кейс на /join (/web/case): shown — заголовок и текст заполнены, блок показываем. */
export type JoinCase = Schemas['JoinCaseCase']

/** GET открытого адреса: ответ, null — ошибка; status — чтобы отличить 404 от «нет связи». */
export async function getJson<T>(path: string): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(path)
    return { status: response.status, data: response.ok ? (await response.json()) as T : null }
  } catch {
    return { status: 0, data: null }
  }
}

/** POST JSON на открытый адрес: ответ или ошибка (Problem Details); status 0 — нет связи. */
export async function postJson<T>(path: string, body: unknown): Promise<{ status: number; data: T | null; problem: SiteProblem | null }> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (response.ok) return { status: response.status, data: (await response.json()) as T, problem: null }
    return { status: response.status, data: null, problem: (await response.json().catch(() => ({}))) as SiteProblem }
  } catch {
    return { status: 0, data: null, problem: null }
  }
}

/** Язык страницы: выбранный раньше (только «ru»/«ky» в localStorage — не личные данные) или язык браузера. */
export function useSiteLang(): ['ru' | 'ky', (l: 'ru' | 'ky') => void] {
  const [lang, setLang] = useState<'ru' | 'ky'>(() => {
    try {
      const saved = localStorage.getItem('clinic.lang')
      if (saved === 'ru' || saved === 'ky') return saved
    } catch {
      // приватный режим
    }
    return navigator.language?.toLowerCase().startsWith('ky') ? 'ky' : 'ru'
  })
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  return [lang, (next) => {
    setLang(next)
    try {
      localStorage.setItem('clinic.lang', next)
    } catch {
      // приватный режим
    }
  }]
}

export function initials(name = ''): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('')
}

/** Код клиники: из адреса /c/<код> (на проде) или ?code= (проверка до переключения nginx). */
export function clinicCode(): string | null {
  return window.location.pathname.match(/^\/c\/([a-z0-9]+)/)?.[1] ?? new URLSearchParams(window.location.search).get('code')
}

/** Браузер внутри Instagram, Facebook, TikTok и т. п.: ссылка t.me там часто не открывает Telegram. */
export const inAppBrowser = () => /Instagram|FBAN|FBAV|Line\/|TikTok|musical_ly/i.test(navigator.userAgent)

/**
 * Запасная ссылка в приложение Telegram для https://t.me/<бот>?start=<…>: tg://resolve с тем же
 * start — встроенный браузер Instagram открывает её сразу в Telegram. Не t.me — null.
 */
export function tgLink(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const domain = u.pathname.split('/').filter(Boolean)[0]
    if (u.hostname !== 't.me' || !domain || !/^\w+$/.test(domain)) return null
    const start = u.searchParams.get('start')
    return `tg://resolve?domain=${domain}${start ? `&start=${encodeURIComponent(start)}` : ''}`
  } catch {
    return null
  }
}

/** Промокод рекламы из адреса (?promo=ZUBY10) — только латиница и цифры: их пропускает start бота. */
export function promoCode(): string | null {
  const code = new URLSearchParams(window.location.search).get('promo') ?? ''
  return /^[A-Za-z0-9]{3,20}$/.test(code) ? code.toUpperCase() : null
}

/**
 * Ссылка на бота с промокодом: t.me/<бот>?start=c_<клиника> → c_<клиника>-<ПРОМОКОД> (бот запомнит
 * код и подставит его в форму записи). Нет кода или ссылка не клиники — как была.
 */
export function withPromo(url: string | null | undefined, promo: string | null): string | null {
  if (!url) return null
  if (!promo) return url
  try {
    const u = new URL(url)
    const start = u.searchParams.get('start')
    if (!start?.startsWith('c_')) return url
    u.searchParams.set('start', `${start}-${promo}`)
    return u.toString()
  } catch {
    return url
  }
}

/** Главная страница сайта — ссылка из Instagram (/go): с неё приходят на остальные страницы. */
export const SITE_HOME = '/go'

/**
 * Пришли сюда с нашей же страницы (/go → /join): тогда «Назад» — шаг назад в истории, со своей
 * прокруткой. Открыли по ссылке снаружи (Instagram, WhatsApp) — истории нет, «Назад» ведёт на /go.
 */
export function cameFromSite(): boolean {
  try {
    return window.history.length > 1 && new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}
