import { useEffect, useState } from 'react'

import type { Schemas } from '../api/client'

/**
 * Ответы открытых адресов /web/* (страницы сайта без входа). Они не входят в контракт /api
 * (docs/api/openapi.json), поэтому типы — здесь, по записям контроллеров бэкенда:
 * ClinicPageController.Page, DirectoryController.Clinic, LinksController.Links.
 */
export type SiteDoctor = { fullName: string; about?: string | null; photoUrl?: string | null }

export type ClinicPage = {
  name?: string | null; address?: string | null; mapUrl?: string | null; phone?: string | null; phoneText?: string | null
  whatsapp?: string | null; telegramUrl?: string | null; doctors: SiteDoctor[]
  services: { name: string; durationMinutes: number; priceSom?: number | null }[]
  /** Новая клиника ещё настраивается (V95): записи нет, telegramUrl пуст */
  settingUp?: boolean
}

export type DirectoryClinic = {
  name?: string | null; address?: string | null; mapUrl?: string | null; pageUrl: string; telegramUrl?: string | null; doctors: SiteDoctor[]
}

export type Links = { supportTelegram?: string | null; supportUrl?: string | null; supportPhone?: string | null; botUrl?: string | null }

export type Tariffs = Schemas['Tariffs']

/** GET открытого адреса: ответ, null — ошибка; status — чтобы отличить 404 от «нет связи». */
export async function getJson<T>(path: string): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(path)
    return { status: response.status, data: response.ok ? (await response.json()) as T : null }
  } catch {
    return { status: 0, data: null }
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

/** Поиск без регистра и «ё»: «улыбка», «Айгерим», «Манаса». */
export function matches(c: DirectoryClinic, query: string): boolean {
  const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е')
  const text = norm([c.name, c.address, ...c.doctors.map((d) => d.fullName)].filter(Boolean).join(' '))
  return norm(query).split(/\s+/).filter(Boolean).every((w) => text.includes(w))
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
