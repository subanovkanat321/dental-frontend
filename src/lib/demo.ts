/**
 * «Демо-клиника без регистрации» (бэкенд: docs/adr/0005-demo-clinic.md). Вход гостем — /demo; сервер ставит HttpOnly
 * cookie сессии и открытую метку `tish_demo=<роль>` на тот же срок (2 часа): по ней страница знает «это демо», даже в
 * новой вкладке, а истекла сессия — метка исчезает сама. Секрета в метке нет; что гостю можно, решает сервер.
 */

/** Регистрация из демо: метка канала — «Платформа → Аналитика → откуда пришли». */
export const DEMO_SIGNUP = '/start?from=demo'

/** Вход в демо — страница /demo (кнопка «Посмотреть демо» на сайте). */
export const DEMO_PATH = '/demo'

const MARK = 'tish_demo'

/** Роль гостя из метки («owner», «reception», «doctor»); не демо — null. */
export function demoRole(cookie = typeof document === 'undefined' ? '' : document.cookie): string | null {
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === MARK) {
      const value = rest.join('=').trim()
      return value ? value : null
    }
  }
  return null
}

export function isDemoSession(): boolean {
  return demoRole() !== null
}

const TOUR_SEEN = 'tish.demo.tourSeen'

/**
 * Тур в демо: «сотрудник» у всех гостей общий — сервер отметку не хранит, помнит вкладка (sessionStorage, только флаг).
 */
export function demoTourSeen(): string | null {
  try {
    return sessionStorage.getItem(TOUR_SEEN)
  } catch {
    return null
  }
}

export function markDemoTourSeen(): string {
  const at = new Date().toISOString()
  try {
    sessionStorage.setItem(TOUR_SEEN, at)
  } catch {
    // приватный режим — тур покажется ещё раз после перезагрузки
  }
  return at
}
