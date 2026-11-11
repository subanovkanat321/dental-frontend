/**
 * Страны, номера которых знаем: код, сколько цифр после него и как делить на группы для показа.
 * Хранится номер цифрами с кодом страны (996555123456) — как на сервере (PhoneNumbers.java), там же
 * проверка длины; здесь только показ. Казахстан и Россия — один код +7: Казахстан — номера на 6 и 7.
 */
export type PhoneCountry = { id: string; code: string; flag: string; name: string; groups: number[]; example: string }

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { id: 'KG', code: '996', flag: '🇰🇬', name: 'Кыргызстан', groups: [3, 3, 3], example: '555 123 456' },
  { id: 'KZ', code: '7', flag: '🇰🇿', name: 'Казахстан', groups: [3, 3, 2, 2], example: '701 123 45 67' },
  { id: 'RU', code: '7', flag: '🇷🇺', name: 'Россия', groups: [3, 3, 2, 2], example: '912 345 67 89' },
  { id: 'UZ', code: '998', flag: '🇺🇿', name: 'Узбекистан', groups: [2, 3, 2, 2], example: '90 123 45 67' },
  { id: 'TJ', code: '992', flag: '🇹🇯', name: 'Таджикистан', groups: [2, 3, 2, 2], example: '93 123 45 67' },
  { id: 'TR', code: '90', flag: '🇹🇷', name: 'Турция', groups: [3, 3, 2, 2], example: '532 123 45 67' },
]

/** «Другая страна»: код набирают сами, после «+». */
export const OTHER_COUNTRY: PhoneCountry = { id: 'XX', code: '', flag: '🌐', name: 'Другая страна', groups: [], example: 'код страны и номер' }

/** Страна по цифрам с кодом; для +7 — по первой цифре номера (6, 7 — Казахстан), нет её — `seven`. */
export function countryOf(digits: string, seven: 'KZ' | 'RU' = 'KZ'): PhoneCountry | undefined {
  const known = PHONE_COUNTRIES.find((c) => c.id !== 'RU' && digits.startsWith(c.code))
  if (known?.code !== '7') return known
  const first = digits.charAt(1)
  const id = !first ? seven : first === '6' || first === '7' ? 'KZ' : 'RU'
  return PHONE_COUNTRIES.find((c) => c.id === id)
}

/**
 * 996555123456 → +996 555 123 456, 77012345678 → +7 701 234 56 78, 998901234567 → +998 90 123 45 67;
 * другая страна — «+», последние 7 цифр группами: +4930 123 45 67 (как PhoneNumbers.format на сервере).
 */
export function formatPhone(digits: string): string {
  if (!/^\d+$/.test(digits)) return digits
  const c = countryOf(digits)
  if (c && digits.length === c.code.length + c.groups.reduce((a, b) => a + b, 0)) {
    let at = c.code.length
    return `+${c.code} ${c.groups.map((g) => digits.slice(at, (at += g))).join(' ')}`
  }
  if (digits.length < 8) return `+${digits}`
  const head = digits.length - 7
  return `+${digits.slice(0, head)} ${digits.slice(head, head + 3)} ${digits.slice(head + 3, head + 5)} ${digits.slice(head + 5)}`
}

/**
 * Номер как цифры с кодом страны (wa.me, sms:): «0555 123 456», «555123456», «+996 555 123 456» →
 * «996555123456»; пусто — undefined. Единственный такой помощник — не копировать в файлы.
 */
export function phoneDigits(input: string): string | undefined {
  const d = input.replace(/\D/g, '')
  if (!d) return undefined
  if (/^0\d{9}$/.test(d)) return `996${d.slice(1)}`
  if (/^\d{9}$/.test(d)) return `996${d}`
  return d
}

/** Строка поиска как цифры номера: «0555 12» → «55512» (без 0 и кода страны: ищем по части номера). */
export function phoneSearchDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^(00|996|0)/, '')
}
