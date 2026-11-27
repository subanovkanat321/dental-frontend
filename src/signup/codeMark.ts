/**
 * Метка «с этого устройства недавно отправляли код на почту» (/start): только время, без почты и номера — не личные
 * данные. По ней страница после перезагрузки спрашивает сервер, ждёт ли шаг кода (cookie шага). localStorage, а не
 * sessionStorage: встроенный браузер
 * Instagram, закрывшись, теряет вкладку целиком. Нет доступа к хранилищу (приватное окно) — просто без подсказки.
 */
const KEY = 'tish.signup.emailCodeAt'

/** Сколько метка «свежая» — столько живёт код из письма (10 минут). */
export const CODE_MARK_MS = 10 * 60 * 1000

export function markCodeSent(now = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now))
  } catch {
    // хранилище закрыто — без подсказки
  }
}

export function recentCodeSent(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(KEY))
    return at > 0 && now - at >= 0 && now - at < CODE_MARK_MS
  } catch {
    return false
  }
}

export function clearCodeSent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // нечего стирать
  }
}
