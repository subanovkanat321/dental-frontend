import { useSyncExternalStore } from 'react'

import { hashParts, type Page } from './route'

/**
 * Подраздел раздела — второй кусок адреса: #/cash/salary, #/patients/waitlist, #/platform/tickets.
 * «Клиника» — тоже: #/clinic/staff (старые #/settings/doctors ведут сюда, lib/route).
 * Его показывают и меню слева (дерево, лист на телефоне), и сам раздел (что рисовать).
 *
 * Последний подраздел каждого раздела запоминается (пока открыта вкладка браузера): ушли в
 * «Расписание» и вернулись в «Кассу» (#/cash без подраздела) — снова «Зарплата», как было с
 * вкладками. «Настройки» — тоже (с 2026-11-13 их пункты — вкладками): #/settings/messages (вкладка — третий кусок: #/settings/messages/debt).
 *
 * С 2026-11-20 запоминается и на устройстве (`localStorage`, только ключи подразделов — без данных): лист
 * подразделов из нижнего меню первым пунктом предлагает последний открытый, и после перезапуска приложения тоже.
 */
export const LAST_SUB_KEY = 'crm.lastSub'

function loadLast(): Partial<Record<Page, string>> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_SUB_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([k, v]) => (WITH_SUBS as readonly string[]).includes(k) && typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v))) as Partial<Record<Page, string>>
  } catch {
    return {}
  }
}

function saveLast(): void {
  try {
    localStorage.setItem(LAST_SUB_KEY, JSON.stringify(last))
  } catch {
    // приватный режим — помним до закрытия вкладки
  }
}
const WITH_SUBS: readonly Page[] = ['patients', 'cash', 'stock', 'clinic', 'settings', 'platform']
const last: Partial<Record<Page, string>> = loadLast()
const listeners = new Set<() => void>()

/** Подраздел в адресе сейчас: [раздел, подраздел] или null. */
function fromHash(): [Page, string] | null {
  const [name, sub] = hashParts()
  return (WITH_SUBS as readonly string[]).includes(name) && sub ? [name as Page, sub] : null
}

function read(): void {
  const found = fromHash()
  if (!found || last[found[0]] === found[1]) return
  last[found[0]] = found[1]
  saveLast()
  for (const l of listeners) l()
}

let listening = false
function subscribe(listener: () => void): () => void {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('hashchange', read)
  }
  read()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Подраздел из адреса (или последний открытый в этом разделе); null — ещё не выбирали. */
export function useSub(page: Page): string | null {
  return useSyncExternalStore(subscribe, () => {
    // Адрес поменяли до первой отрисовки (ссылка, тест) — берём из него, не дожидаясь hashchange
    const found = fromHash()
    if (found && found[0] === page && last[page] !== found[1]) {
      last[page] = found[1]
      saveLast()
    }
    return last[page] ?? null
  })
}

/** Адрес подраздела — для href ссылки в меню. */
export function subHref(page: Page, sub: string): string {
  return page === 'settings' ? `#/settings/${sub}` : `#/${page}/${sub}`
}

/**
 * Открыть подраздел. В том же разделе — заменой адреса: переключение подразделов, как раньше
 * вкладок, не копит шаги «назад» (браузер, Android) — «назад» уводит из раздела. Из другого
 * раздела — обычный переход, новой записью.
 */
export function openSub(page: Page, sub: string): void {
  const [name = ''] = window.location.hash.replace(/^#\/?/, '').split('/')
  const hash = `#/${page}/${sub}`
  if (name === page && typeof window.location.replace === 'function') window.location.replace(hash)
  else window.location.hash = hash
  // jsdom и старые браузеры: replace не всегда шлёт hashchange — прочитаем сами
  read()
}

/** Тесты: забыть запомненные подразделы. */
export function resetSubs(): void {
  for (const k of Object.keys(last)) delete last[k as Page]
  try { localStorage.removeItem(LAST_SUB_KEY) } catch { /* приватный режим */ }
  const found = fromHash()
  if (found) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${found[0]}`)
}
