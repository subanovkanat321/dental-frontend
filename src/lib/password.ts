/**
 * Требования к паролю — те же, что проверяет сервер (бэкенд, auth.internal.PasswordRules). Здесь —
 * только подсказка до отправки: последнее слово за сервером (ошибка 422 под полем).
 */
export const PASSWORD_MIN = 8

export type PasswordCheck = { long: boolean; notDigits: boolean; notPhone: boolean }

/** Последние 9 цифр номера — так сервер сравнивает «пароль = номер». */
function lastNine(text: string): string {
  return text.replace(/\D/g, '').slice(-9)
}

export function checkPassword(password: string, phone: string): PasswordCheck {
  const digitsOnly = /^[\d\s+()-]*$/.test(password)
  return {
    long: password.length >= PASSWORD_MIN,
    notDigits: password.length > 0 && !/^\d+$/.test(password),
    notPhone: !(digitsOnly && lastNine(password).length === 9 && lastNine(password) === lastNine(phone)),
  }
}

/** Что не так — по-русски, как ответит сервер; подходит — пустая строка. */
export function passwordProblem(password: string, repeat: string, phone: string): string {
  const c = checkPassword(password, phone)
  if (!password) return 'Придумайте пароль'
  if (!c.long) return `Пароль — не короче ${PASSWORD_MIN} символов`
  if (!c.notDigits) return 'Пароль не может состоять только из цифр — добавьте буквы'
  if (!c.notPhone) return 'Пароль не должен совпадать с номером телефона'
  if (password !== repeat) return 'Пароли не совпадают'
  return ''
}
