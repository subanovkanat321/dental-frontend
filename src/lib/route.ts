import { useEffect, useState } from 'react'

/**
 * Разделы CRM. Адрес — во фрагменте (#/patients): CRM отдаёт nginx одним index.html.
 * «Клиника» (#/clinic/<пункт>) — раздел меню с 2026-11-10 (бывшая группа «Настроек»). «Я» (#/me/<пункт>)
 * и «Помощь» (#/help/<пункт>) в дереве меню не раздел: их открывает блок «Я» и «Помощь» внизу меню.
 */
export type Page = 'schedule' | 'patients' | 'learn' | 'cash' | 'stock' | 'clinic' | 'settings' | 'platform' | 'me' | 'help'

const PAGES: readonly Page[] = ['schedule', 'patients', 'learn', 'cash', 'stock', 'clinic', 'settings', 'platform', 'me', 'help']

/**
 * Пункты, переехавшие из «Настроек» (2026-11-10): старый адрес #/settings/<пункт> (закладки, кнопки
 * бота, руководство) — куда он ведёт теперь. «Персонал» стал staff (был doctors, ещё раньше members).
 */
const MOVED: Record<string, string> = {
  about: 'clinic/about', doctors: 'clinic/staff', members: 'clinic/staff', staff: 'clinic/staff', services: 'clinic/services',
  hours: 'clinic/hours', chairs: 'clinic/chairs', shifts: 'clinic/shifts', timeoff: 'clinic/timeoff',
  profile: 'me/profile', appearance: 'me/appearance', calendar: 'me/calendar', notifications: 'me/notifications', install: 'me/install',
  guide: 'help/guide', support: 'help/support', help: 'help/chat', survey: 'help/survey', privacy: 'help/privacy',
  // «Показать пациенту» стал разделом «Для пациента»
  learn: 'learn',
}

/**
 * Вкладки «Платформы», объединённые 2026-11-14 (их было 14 — не влезали в строку): старый адрес
 * #/platform/<вкладка> (закладки, «⌄», руководство, кнопки) — новая вкладка и её режим (третий кусок адреса).
 * «Договор» и «Тарифы» стали разделами «Настроек» платформы — третий кусок там — якорь раздела.
 */
export const PLATFORM_MOVED: Record<string, string> = {
  outreach: 'mailing/one', broadcast: 'mailing/all',
  tickets: 'feedback/tickets', support: 'feedback/tickets', surveys: 'feedback/surveys',
  content: 'marketing/content', materials: 'marketing/materials',
  agreements: 'settings/contract', contract: 'settings/contract', tariffs: 'settings/tariffs',
}

/** Совсем старые разделы (закладки до «Настроек»): «Команда», «Аккаунт». */
const OLD: Record<string, string> = { team: 'clinic/staff', account: 'help/support' }

/**
 * Адрес как части [раздел, пункт]. Старый адрес заменяем новым на месте (replaceState — без лишнего
 * шага «назад»): дальше и меню, и раздел читают уже новый. Зовут все, кто читает адрес, — кто бы ни
 * прочитал первым после hashchange, увидит одно и то же.
 */
export function hashParts(): [string, string | undefined] {
  const [name = '', item] = window.location.hash.replace(/^#\/?/, '').split('/')
  let to: string | undefined
  if (name === 'settings' && item && MOVED[item]) to = MOVED[item]
  else if (OLD[name]) to = OLD[name]
  else if (name === 'clinic' && (item === 'doctors' || item === 'members')) to = 'clinic/staff'
  else if (name === 'platform' && item && PLATFORM_MOVED[item]) to = `platform/${PLATFORM_MOVED[item]}`
  if (!to) return [name, item]
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/${to}`)
  const [n = '', i] = to.split('/')
  return [n, i]
}

function current(): Page {
  const [name] = hashParts()
  return (PAGES as readonly string[]).includes(name) ? (name as Page) : 'schedule'
}

/** Пункт раздела из адреса: #/settings/reminder → 'reminder', #/me/profile → 'profile'; без пункта — null. */
export function itemOf(page: Page): string | null {
  const [name, item] = hashParts()
  return name === page && item ? item : null
}

/** Запись истории — пункт, открытый из приложения (список «Настроек», блок «Я», «Помощь»): назад — шаг по истории. */
type FromApp = { tishFromSettings?: boolean }

function fromSettingsList(): boolean {
  return Boolean((window.history.state as FromApp | null)?.tishFromSettings)
}

/** Перейти и пометить новую запись (тот же адрес, только state), если открыли из приложения. */
function go(hash: string, mark = window.location.hash.replace(/^#\/?/, '') === 'settings'): void {
  window.location.hash = hash
  if (mark) window.history.replaceState({ ...(window.history.state as object | null), tishFromSettings: true }, '')
}

/**
 * Открыть пункт «Настроек» — отдельной записью в истории: «Назад» вернёт. null — назад в список:
 * пришли из него — шагом назад по истории (иначе «Назад» телефона потом снова открыл бы пункт),
 * по ссылке (бот, закладка) — новой записью. Переехавший пункт (#/settings/doctors) — по новому адресу.
 */
export function openSettings(item: string | null): void {
  if (item == null && fromSettingsList()) window.history.back()
  else if (item == null) window.location.hash = '/settings'
  else if (MOVED[item]) go(`/${MOVED[item]}`)
  else go(`/settings/${item}`)
}

/** Пункт раздела «Клиника»: #/clinic/staff. Внутри раздела — как подраздел (lib/sub). */
export function openClinic(item: string): void {
  window.location.hash = `/clinic/${item}`
}

/**
 * «Клиника → Рабочее время → График» с раскрытым редактором недели человека: #/clinic/hours/d12 (врач) или
 * #/clinic/hours/s555 (сотрудник, Telegram id). Единственное место, где меняют часы работы: карточка в
 * «Персонале» и «Мой профиль» ведут сюда. Новой записью — «Назад» вернёт в карточку.
 */
export function openWeekOf(person: string): void {
  window.location.hash = `/clinic/hours/${person}`
}

/** Чей редактор недели открыть по адресу (#/clinic/hours/d12 → 'd12'); иначе null. */
export function weekPersonInHash(): string | null {
  const [name, item, person] = window.location.hash.replace(/^#\/?/, '').split('/')
  return name === 'clinic' && item === 'hours' && person && /^[ds]-?\d+$/.test(person) ? person : null
}

/**
 * «Платформа → Клиники» с открытой карточкой клиники: #/platform/clinics/12. Строки «Аналитики» («Кому звонить»,
 * «Кто может уйти») ведут сюда — новой записью: «Назад» вернёт в аналитику.
 */
export function openPlatformClinic(id: number): void {
  window.location.hash = `/platform/clinics/${id}`
}

/** Чью карточку клиники открыть по адресу (#/platform/clinics/12 → 12); иначе null. */
export function platformClinicInHash(): number | null {
  const [name, item, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  return name === 'platform' && item === 'clinics' && id && /^\d+$/.test(id) ? Number(id) : null
}

/** Карточку закрыли — адрес снова просто «Клиники» (заменой: без лишнего шага «назад»). */
export function clearPlatformClinic(): void {
  if (platformClinicInHash() == null) return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/platform/clinics`)
}

/** Третий кусок адреса «Платформы»: режим вкладки (#/platform/mailing/all → 'all') или якорь «Настроек»; иначе null. */
export function platformModeInHash(sub: string): string | null {
  hashParts()
  const [name, item, mode] = window.location.hash.replace(/^#\/?/, '').split('/')
  return name === 'platform' && item === sub && mode ? mode : null
}

/** Сменили режим вкладки — адрес заменой (переключатель, как вкладки, не копит шаги «назад»). */
export function setPlatformModeInHash(sub: string, mode: string): void {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/platform/${sub}/${mode}`)
}

/** Пункт блока «Я» (#/me/profile) или «Помощи» (#/help/guide) — новой записью: «‹ Назад» вернёт, откуда открыли. */
export function openMine(page: 'me' | 'help', item: string): void {
  go(`/${page}/${item}`, true)
}

/** «‹ Назад» из пункта «Я» или «Помощи»: открыли из приложения — шаг назад, по ссылке — в расписание. */
export function backFromMine(): void {
  if (fromSettingsList()) window.history.back()
  else window.location.hash = '/schedule'
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
