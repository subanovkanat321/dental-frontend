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
