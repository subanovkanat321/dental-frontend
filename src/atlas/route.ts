import { useEffect, useState } from 'react'

import { isFdi, isMode, type AtlasMode } from './ids'

/** Что открыть в атласе: режим разреза или номер зуба на челюсти. */
export interface AtlasRoute {
  mode?: AtlasMode
  tooth?: number
}

/**
 * Атлас по адресу: «#/atlas», «#/atlas/caries», «#/atlas/36» (внутри CRM) или «/atlas» (ссылка для ТВ).
 * В CRM атлас открывают из раздела «Для пациента» и из карточки приёма (кнопка «3D»), этот адрес — для ТВ.
 */
export function readAtlasRoute(hash = window.location.hash, path = window.location.pathname): AtlasRoute | null {
  const parts = hash.replace(/^#\/?/, '').split('/')
  const fromPath = /^\/atlas\/?$/i.test(path)
  if (parts[0] !== 'atlas' && !fromPath) return null
  const arg = parts[0] === 'atlas' ? parts[1] : undefined
  if (arg && isMode(arg)) return { mode: arg }
  if (arg && isFdi(Number(arg))) return { tooth: Number(arg) }
  return {}
}

export function useAtlasRoute(): AtlasRoute | null {
  const [route, setRoute] = useState(() => readAtlasRoute())
  useEffect(() => {
    const onHash = () => setRoute(readAtlasRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

/** Закрыть: назад в CRM (на главную — расписание). */
export function closeAtlas(): void {
  if (/^\/atlas\/?$/i.test(window.location.pathname)) window.location.replace('/#/schedule')
  else window.location.hash = '/schedule'
}
