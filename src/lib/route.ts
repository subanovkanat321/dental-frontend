import { useEffect, useState } from 'react'

/** Разделы CRM. Адрес — во фрагменте (#/patients): CRM отдаёт nginx одним index.html. */
export type Page = 'schedule' | 'patients' | 'learn' | 'cash' | 'stock' | 'settings' | 'platform'

const PAGES: readonly Page[] = ['schedule', 'patients', 'learn', 'cash', 'stock', 'settings', 'platform']
/** Прежние адреса разделов (закладки) — теперь пункты «Настроек». */
const OLD: Record<string, string> = { team: 'doctors', clinic: 'about', account: 'support' }

function current(): Page {
  const [name = '', item] = window.location.hash.replace(/^#\/?/, '').split('/')
  // «Настройки → Показать пациенту» стали разделом «Для пациента» (#/learn) — старые ссылки ведут туда
  if (name === 'settings' && item === 'learn') {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/learn`)
    return 'learn'
  }
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

/** Запись истории — пункт, открытый из списка «Настроек»: «‹ Настройки» — это шаг назад по ней. */
type FromSettings = { tishFromSettings?: boolean }

function fromSettingsList(): boolean {
  return Boolean((window.history.state as FromSettings | null)?.tishFromSettings)
}

/** Открыли из главной «Настроек» — пометить новую запись (тот же адрес, только state). */
function go(hash: string): void {
  const fromList = window.location.hash.replace(/^#\/?/, '') === 'settings'
  window.location.hash = hash
  if (fromList) window.history.replaceState({ ...(window.history.state as object | null), tishFromSettings: true }, '')
}

/**
 * Открыть пункт «Настроек» — отдельной записью в истории: «Назад» вернёт. null — назад в список:
 * пришли из него — шагом назад по истории (иначе «Назад» телефона потом снова открыл бы пункт),
 * по ссылке (бот, закладка) — новой записью.
 */
export function openSettings(item: string | null): void {
  if (item == null && fromSettingsList()) window.history.back()
  else if (item == null) window.location.hash = '/settings'
  else go(`/settings/${item}`)
}

/** Перейти в раздел меню (из пункта «Настроек»-ссылки). */
export function openSection(page: Page): void {
  go(`/${page}`)
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

/** Страница по ссылке-приглашению (врач, сотрудник): /invite#join_… или /invite#staff_… — без входа. */
export function isInvitePath(path = window.location.pathname): boolean {
  return /^\/invite\/?$/i.test(path)
}
