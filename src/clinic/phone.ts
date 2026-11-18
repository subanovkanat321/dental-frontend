import { countryOf, formatPhone, OTHER_COUNTRY, PHONE_COUNTRIES, type PhoneCountry } from '../lib/phone'

/**
 * Поле телефона хранит текст для запроса без пробелов: кыргызский номер — цифры как набраны
 * («555123456», «0555…», «996…»), номер другой страны — с кодом («+77011234567»). Группы цифр
 * («555 123 456») — только в самом поле ввода (groupLocal). Нормализует и проверяет сервер.
 */

/**
 * Невидимое и «экзотические» пробелы — прочь: iPhone вставляет номер из контактов в метках
 * направления текста (U+202A…U+202C), клавиатуры ставят неразрывный пробел и длинное тире. Глазом
 * номер верный, а «+996» дописывался второй раз и сервер номер отклонял.
 */
export function cleanPhone(v: string): string {
  return v.replace(/\p{Cf}/gu, '').replace(/[\p{Zs}]/gu, ' ').replace(/[\u2010-\u2015\u2212]/g, '-')
}

/**
 * Номер из любого текста — вставили в поле, скопировали из «Контактов», пришёл из записной книжки или от
 * бота: «+996 555 12-34-56», «996555123456», «0555123456», «(555) 123 456», «Айгуль +996 555 123 456».
 * Кыргызский номер — 9 цифр без 0 и 996 («555123456»: +996 в поле уже стоит), номер другой страны —
 * «+код цифры» (поле само выберет страну). Номера в тексте нет (меньше 9 цифр подряд) — null.
 * Одна функция на все пути: кнопка «Вставить номер», вставка в поле, контакт из бота и Contact Picker.
 */
export function phoneFromText(text: string): string | null {
  // Кусок, похожий на номер: цифры, а между ними пробелы, скобки, точки и дефисы (без переносов строк —
  // иначе дата рождения строкой выше слилась бы с номером)
  const candidates = cleanPhone(text).match(/(?:\+|\b00)?[ \t(]*\d[\d \t().-]*\d/g) ?? []
  const found = candidates.find((c) => c.replace(/\D/g, '').length >= 9)
  if (!found) return null
  const plus = /^\s*(\+|00)/.test(found)
  let d = found.replace(/\D/g, '')
  if (plus && found.trimStart().startsWith('00')) d = d.slice(2)
  if (/^996\d{9}$/.test(d)) return d.slice(3)
  if (plus) return `+${d}`
  if (/^0\d{9}$/.test(d)) return d.slice(1)
  if (/^\d{9}$/.test(d)) return d
  // Без «+», но длиннее кыргызского — скорее всего, с кодом другой страны (WhatsApp пишет «7 701 …»)
  return d.length > 10 ? `+${d}` : d
}

/** Номер набран целиком (с кодом страны или с 0) — тогда «+996» не добавляем. */
function isFullPhone(v: string): boolean {
  return /^(\+|00|996|0)/.test(v.replace(/[\s()-]/g, ''))
}

/** Из поля в запрос: «555 123 456» → «+996555123456», пробелы и дефисы — прочь; пусто — пусто. */
export function phoneFromInput(v: string): string {
  const t = cleanPhone(v).replace(/[\s()-]/g, '')
  return !t || isFullPhone(t) ? t : `+996${t}`
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

/**
 * Страна и номер в поле → значение без пробелов: кыргызский — цифры как набраны, другие — «+кодцифры»;
 * пусто — пусто. Группы, которые поле показывает («555 123 456»), сюда не попадают.
 */
export function joinPhone(country: string, local: string): string {
  const digits = local.replace(/\D/g, '')
  if (!digits) return ''
  if (country === 'KG') return digits
  const c = phoneCountry(country)
  return `+${c.code}${digits}`
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

/**
 * Номер в поле ввода — группами страны: «555123456» → «555 123 456», с нулём — «0555 123 456», с «996» —
 * «996 555 123 456», Казахстан — «701 123 45 67». Цифры сверх групп и номер «Другой страны» — по 3.
 * Только показ: в значение поля (joinPhone) пробелы не попадают.
 */
export function groupLocal(country: string, local: string): string {
  let digits = local.replace(/\D/g, '')
  let lead = ''
  if (country === 'KG' && digits.startsWith('996')) lead = '996 '
  else if (country === 'KG' && digits.startsWith('0')) lead = '0'
  digits = digits.slice(lead.trim().length)
  const groups = phoneCountry(country).groups
  const parts: string[] = []
  for (let i = 0; digits; i++) {
    const size = groups[i] ?? 3
    parts.push(digits.slice(0, size))
    digits = digits.slice(size)
  }
  return parts.length ? `${lead}${parts.join(' ')}` : lead.trim()
}

/** Место каретки в тексте поля сразу после `n`-й цифры (0 — в начале). */
export function caretAfterDigits(text: string, n: number): number {
  if (n <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i]!) && ++seen === n) return i + 1
  }
  return text.length
}

/**
 * Начальное значение второго поля: WhatsApp записи, только если он отличается от телефона. Совпадает — поле пустое
 * и закрыто: иначе, поменяв телефон, человек оставил бы старый номер в скрытом WhatsApp.
 */
export function whatsappToInput(rec?: { phone?: string | null; whatsapp?: string | null }): string {
  return rec?.whatsapp && rec.whatsapp !== rec.phone ? phoneToInput(rec.whatsapp) : ''
}
