import { type ChangeEvent, useRef, useState } from 'react'

import { Select } from '../layout/Select'
import { digitCount, focusNext } from '../lib/advance'
import { OTHER_COUNTRY, PHONE_COUNTRIES } from '../lib/phone'
import { caretAfterDigits, cleanPhone, groupLocal, joinPhone, phoneCountry, phoneFromText, splitPhone } from './phone'

/**
 * Телефон: страна (флаг и код) и номер. По умолчанию Кыргызстан — местный «555 123 456» или «0555…»
 * уходит как набран и дополняется +996 (phoneFromInput). Вставили «+7 701…» или «+998…» — страна
 * переключается сама. Проверяет и нормализует сервер.
 *
 * Пока печатают, номер сам делится на группы страны (groupLocal): «555 123 456», «701 123 45 67». Группы —
 * только на экране: наружу (onChange) уходит значение без пробелов («555123456», «+77011234567»).
 * Каретку ставим по счёту цифр: сколько цифр было слева от неё — столько и после новой разбивки, поэтому
 * правка в середине и Backspace не уносят её в конец. Backspace прямо за пробелом стирает цифру перед ним.
 *
 * Поле ввода в разметке — первым: так подпись `<label>` вокруг ведёт в номер, а не открывает список
 * стран; слева страну ставит CSS (`order`).
 */
/** Сколько цифр самого номера: у кыргызского без «0» и «996», набранных в начале. */
function numberDigits(country: string, local: string): number {
  const d = local.replace(/\D/g, '')
  if (country !== 'KG') return d.length
  return d.startsWith('996') ? d.length - 3 : d.startsWith('0') ? d.length - 1 : d.length
}

const onlyDigits = (s: string) => s.replace(/\D/g, '')

export function PhoneInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // Выбранная страна нужна, пока номер пуст: в самом значении её ещё нет
  const [picked, setPicked] = useState(() => splitPhone(value, 'KG').country)
  const { country, local } = splitPhone(value, picked)
  const c = phoneCountry(country)
  const shown = groupLocal(country, local)
  const input = useRef<HTMLInputElement>(null)

  /**
   * Вставили номер целиком (Ctrl+V, «Вставить» на iPhone, автозаполнение) — разбираем общим phoneFromText:
   * «+996 773 12-34-56», «0773123456», «996773123456» → «773123456», +996 уже стоит; текст с именем — только номер.
   * Кыргызским считаем номер с 996 или 0 в начале, а 9 цифр без них — если выбран Кыргызстан (у Узбекистана тоже 9).
   */
  const fromWhole = (raw: string): string | null => {
    const parsed = phoneFromText(raw)
    if (parsed == null) return null
    if (parsed.startsWith('+')) return parsed
    const digits = cleanPhone(raw).replace(/\D/g, '')
    return country === 'KG' || /^(996|0)/.test(digits) ? parsed : joinPhone(country, parsed)
  }

  /**
   * @param raw текст поля после правки (или вставленный текст)
   * @param before сколько цифр слева от каретки; null — каретку в конец
   */
  const type = (raw: string, before: number | null, paste = false) => {
    // Печатают по цифре; добавилось сразу несколько цифр или буквы — это вставка (или автозаполнение)
    const pasted = paste || onlyDigits(raw).length - onlyDigits(local).length > 1 || /\p{L}/u.test(raw)
    const parsed = pasted ? fromWhole(raw) : null
    // Номер другой страны без лишнего текста — как вставили: страну поле поймёт по «+»
    const whole = parsed != null && (!parsed.startsWith('+') || /\p{L}/u.test(raw) || !/^\s*(\+|00)/.test(cleanPhone(raw))) ? parsed : null
    const typed = cleanPhone(raw).trim()
    const text = whole ?? `${typed.startsWith('+') ? '+' : ''}${onlyDigits(typed)}`
    // Набрали или вставили номер с «+» — он сам говорит, какая страна
    const next = whole != null && !whole.startsWith('+')
      ? splitPhone(whole, 'KG')
      : splitPhone(/^(\+|00)/.test(text) ? text : joinPhone(country, text) || '', country)
    setPicked(next.country)
    onChange(joinPhone(next.country, next.local))

    // Текст и каретку ставим сразу: React потом увидит в поле то же значение и не тронет ни его, ни каретку
    const el = input.current
    if (el) {
      const grouped = groupLocal(next.country, next.local)
      const at = pasted || before == null || next.country !== country ? grouped.length : caretAfterDigits(grouped, before)
      if (el.value !== grouped) el.value = grouped
      if (document.activeElement === el) el.setSelectionRange(at, at)
    }

    // Набрали номер целиком — в форме с data-advance сразу к следующему полю
    // Номер считаем без «0» и «996» в начале: «0772 666 666» — это 9 цифр номера, а не «полный» на
    // девятой цифре (иначе фокус уходил дальше, последняя цифра терялась, сервер номер отклонял)
    const need = digitCount(phoneCountry(next.country).example)
    const digits = numberDigits(next.country, next.local)
    if (need > 0 && digits === need && numberDigits(country, local) < need) focusNext(input.current)
  }

  const edit = (e: ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value
    const pos = e.target.selectionStart ?? raw.length
    let before = onlyDigits(raw.slice(0, pos)).length
    // Стёрли только пробел между группами (Backspace сразу за ним, Delete перед ним) — он тут же вернётся,
    // и каретка встанет на место. Стираем цифру рядом с ним, как ждёт человек.
    if (onlyDigits(raw) === onlyDigits(shown) && raw.length < shown.length) {
      const forward = (e.nativeEvent as InputEvent).inputType === 'deleteContentForward'
      const i = forward ? before : before - 1
      const digits = onlyDigits(raw)
      if (i >= 0 && i < digits.length) {
        raw = digits.slice(0, i) + digits.slice(i + 1)
        before = i
      }
    }
    type(raw, pos >= e.target.value.length ? null : before)
  }

  const pick = (id: string) => {
    setPicked(id)
    onChange(joinPhone(id, local))
  }

  return (
    <div className="phone">
      <input ref={input} aria-label={label} type="tel" enterKeyHint="next" inputMode="tel" autoComplete="off" maxLength={24} placeholder={c.example}
        value={shown} onChange={edit}
        onPaste={(e) => {
          // Вставка заменяет поле целиком: «555» + вставленный «+996 555 …» не должны слиться в один номер
          const pasted = e.clipboardData?.getData('text') ?? ''
          if (phoneFromText(pasted) == null) return
          e.preventDefault()
          type(pasted, null, true)
        }} />
      <Select aria-label="Код страны" value={country} onChange={(e) => pick(e.target.value)}>
        {[...PHONE_COUNTRIES, OTHER_COUNTRY].map((o) => (
          <option key={o.id} value={o.id}>{`${o.flag} +${o.code} · ${o.name}`}</option>
        ))}
      </Select>
    </div>
  )
}
