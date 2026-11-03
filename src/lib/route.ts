import { useEffect, useState } from 'react'

/** Разделы CRM. Адрес — во фрагменте (#/patients): CRM отдаёт nginx одним index.html. */
export type Page = 'schedule' | 'patients' | 'cash' | 'stock' | 'settings' | 'platform'

const PAGES: readonly Page[] = ['schedule', 'patients', 'cash', 'stock', 'settings', 'platform']
/** Прежние адреса разделов (закладки) — теперь пункты «Настроек». */
const OLD: Record<string, string> = { team: 'doctors', clinic: 'about', account: 'support' }

function current(): Page {
  const [name = ''] = window.location.hash.replace(/^#\/?/, '').split('/')
  if (OLD[name]) return 'settings'
  return (PAGES as readonly string[]).includes(name) ? (name as Page) : 'schedule'
}

/** Пункт «Настроек» из адреса: #/settings/hours → 'hours'; на главной «Настроек» — null. */
export function settingsItem(): string | null {
  const [name = '', item] = window.location.hash.replace(/^#\/?/, '').split('/')
  if (OLD[name]) return OLD[name]!
  // «Сотрудники» стали частью «Персонала» (вместе с врачами) — старые ссылки ведут туда
  if (name === 'settings' && item === 'members') return 'doctors'
  return name === 'settings' && item ? item : null
}

/** Открыть пункт «Настроек» (или их главную) — отдельной записью в истории: «Назад» вернёт. */
export function openSettings(item: string | null): void {
  window.location.hash = item ? `/settings/${item}` : '/settings'
}

/**
 * Раздел из адреса: обновили страницу или нажали «Назад» в браузере — остаёмся где были.
 * Своя маленькая «маршрутизация» вместо React Router: разделов пока немного, библиотека — лишний вес.
 */
export function usePage(): [Page, (page: Page) => void] {
  const [page, setPage] = useState(current)
  useEffect(() => {
    const onHash = () => setPage(current())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [page, (next) => { window.location.hash = `/${next}` }]
}

/**
 * Страница входа: «/login» в любом виде, как его набирают — «/login/», «/Login», «/вход», «/crm», «/admin».
 * Раньше «/login/» уводил на каталог для пациентов.
 */
export function isLoginPath(path = window.location.pathname): boolean {
  let p = path
  try {
    p = decodeURIComponent(path)
  } catch {
    // кривой адрес — как есть
  }
  return /^\/(login|вход|crm|admin)\/?$/i.test(p)
}

/** Страница «Скачать Tish» (PWA): tish.kg/app, а также /app/, /download, /скачать. */
export function isDownloadPath(path = window.location.pathname): boolean {
  let p = path
  try {
    p = decodeURIComponent(path)
  } catch {
    // кривой адрес — как есть
  }
  return /^\/(app|download|скачать)\/?$/i.test(p)
}
