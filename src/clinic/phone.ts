import { countryOf, formatPhone, OTHER_COUNTRY, PHONE_COUNTRIES, type PhoneCountry } from '../lib/phone'

/**
 * Поле телефона хранит текст для запроса: кыргызский номер — как набран («555 123 456», «0555…»,
 * «996…»), номер другой страны — с кодом («+7 701 123 45 67»). Нормализует и проверяет сервер.
 */

/**
 * Невидимое и «экзотические» пробелы — прочь: iPhone вставляет номер из контактов в метках
 * направления текста (U+202A…U+202C), клавиатуры ставят неразрывный пробел и длинное тире. Глазом
 * номер верный, а «+996» дописывался второй раз и сервер номер отклонял.
 */
export function cleanPhone(v: string): string {
  return v.replace(/\p{Cf}/gu, '').replace(/[\p{Zs}]/gu, ' ').replace(/[\u2010-\u2015\u2212]/g, '-')
}

/** Номер набран целиком (с кодом страны или с 0) — тогда «+996» не добавляем. */
function isFullPhone(v: string): boolean {
  return /^(\+|00|996|0)/.test(v.replace(/[\s()-]/g, ''))
}

/** Из поля в запрос: «555 123 456» → «+996 555 123 456»; пусто — пусто. */
export function phoneFromInput(v: string): string {
  const t = cleanPhone(v).trim()
  return !t || isFullPhone(t) ? t : `+996 ${t}`
}

/** Из ответа в поле: «996555123456» → «555 123 456», другая страна — «+7 701 123 45 67». */
export function phoneToInput(digits?: string | null): string {
  const d = digits ?? ''
  if (!d) return ''
  return /^996\d{9}$/.test(d) ? `${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : formatPhone(d)
}

export function phoneCountry(id: string): PhoneCountry {
  return PHONE_COUNTRIES.find((c) => c.id === id) ?? OTHER_COUNTRY
}

/**
 * Значение поля → страна в списке и текст в поле ввода: «+7 701…» → Казахстан и «701…», «+49 30…» —
 * «Другая страна» и «49 30…», кыргызский — как есть. Пусто — страна та, что выбрана (`picked`).
 */
export function splitPhone(value: string, picked: string): { country: string; local: string } {
  const full = /^\s*(?:\+|00)(.*)$/s.exec(value)
  if (!full) return { country: value.trim() ? 'KG' : picked, local: value }
  const rest = full[1]!.trimStart()
  const digits = rest.replace(/[\s()-]/g, '')
  const c = /^\d/.test(digits) ? countryOf(digits, picked === 'RU' ? 'RU' : 'KZ') : undefined
  if (!c || !rest.startsWith(c.code)) return { country: OTHER_COUNTRY.id, local: rest }
  return { country: c.id, local: rest.slice(c.code.length).trimStart() }
}

/** Страна и текст в поле → значение: кыргызский — как набран, другие — «+код номер»; пусто — пусто. */
export function joinPhone(country: string, local: string): string {
  if (!local.trim()) return ''
  if (country === 'KG') return local
  const c = phoneCountry(country)
  return c.code ? `+${c.code} ${local}` : `+${local}`
}

/** Сколько номеров для звонка — как на сервере (ContactPhones.MAX). */
export const MAX_PHONES = 3

/** Номера из ответа (цифры) → поля формы; пустой список — одно пустое поле. */
export function phonesToInput(digits?: string[] | null): string[] {
  return digits?.length ? digits.map(phoneToInput) : ['']
}

/** Поля формы → запрос: пустые не отправляем, порядок сохраняем (первый — главный). */
export function phonesFromInput(values: string[]): string[] {
  return values.map(phoneFromInput).filter(Boolean)
}
