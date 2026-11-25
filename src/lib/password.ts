/**
 * Требования к паролю — те же, что проверяет сервер (бэкенд, auth.internal.PasswordRules). Здесь —
 * только подсказка до отправки: последнее слово за сервером (ошибка 422 под полем).
 * С 2026-11-25 — просто: от 7 символов, цифры и заглавные не обязательны; нельзя только номер, логин и самые
 * частые пароли.
 */
export const PASSWORD_MIN = 7

/** Самые частые пароли от 7 символов — как TRIVIAL на сервере (без регистра). */
const TRIVIAL = new Set(['1234567', '12345678', '123456789', '1234567890', '0123456', '01234567', '7654321', '87654321',
  '987654321', '0987654321', 'qwertyu', 'qwerty1', 'qwerty12', 'qwerty123', '1q2w3e4', '1q2w3e4r', 'password', 'password1',
  'йцукенг', 'asdfghj', 'zxcvbnm'])

export type PasswordCheck = { long: boolean; notPhone: boolean; notLogin: boolean; notSimple: boolean }

/** Последние 9 цифр номера — так сервер сравнивает «пароль = номер». */
function lastNine(text: string): string {
  return text.replace(/\D/g, '').slice(-9)
}

export function checkPassword(password: string, phone: string, login = ''): PasswordCheck {
  const digitsOnly = /^[\d\s+()-]*$/.test(password)
  const lower = password.toLowerCase()
  return {
    long: password.length >= PASSWORD_MIN,
    notPhone: !(digitsOnly && lastNine(password).length === 9 && lastNine(password) === lastNine(phone)),
    notLogin: !login.trim() || password.trim().toLowerCase() !== login.trim().toLowerCase(),
    notSimple: password.length > 0 && !TRIVIAL.has(lower) && new Set(lower).size > 1,
  }
}

/** Что не так — по-русски, как ответит сервер; подходит — пустая строка. */
export function passwordProblem(password: string, repeat: string, phone: string, login = ''): string {
  const c = checkPassword(password, phone, login)
  if (!password.trim()) return 'Придумайте пароль'
  if (!c.long) return `Пароль — не короче ${PASSWORD_MIN} символов`
  if (!c.notPhone) return 'Пароль не должен совпадать с номером телефона'
  if (!c.notLogin) return 'Пароль не должен совпадать с логином'
  if (!c.notSimple) return 'Слишком простой пароль — его подбирают первым. Придумайте другой'
  if (password !== repeat) return 'Пароли не совпадают'
  return ''
}
