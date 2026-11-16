import { useRef, useState } from 'react'

import { Select } from '../layout/Select'
import { digitCount, focusNext } from '../lib/advance'
import { OTHER_COUNTRY, PHONE_COUNTRIES } from '../lib/phone'
import { cleanPhone, joinPhone, maskLocal, phoneCountry, phoneFromText, splitPhone } from './phone'

/**
 * Телефон: страна (флаг и код) и номер. По умолчанию Кыргызстан — местный «555 123 456» или «0555…»
 * уходит как набран и дополняется +996 (phoneFromInput). Вставили «+7 701…» или «+998…» — страна
 * переключается сама. Проверяет и нормализует сервер.
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

/** @param mask группировать цифры, пока печатают (самозапись на сайте); в CRM — как набрано */
export function PhoneInput({ label, value, onChange, mask = false }: { label: string; value: string; onChange: (v: string) => void; mask?: boolean }) {
  // Выбранная страна нужна, пока номер пуст: в самом значении её ещё нет
  const [picked, setPicked] = useState(() => splitPhone(value, 'KG').country)
  const { country, local } = splitPhone(value, picked)
  const c = phoneCountry(country)
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

  const type = (raw: string, atEnd = false, paste = false) => {
    // Печатают по цифре — как набрано; добавилось сразу несколько символов или буквы — это вставка
    const pasted = paste || cleanPhone(raw).length - local.length > 1 || /\p{L}/u.test(raw)
    const parsed = pasted ? fromWhole(raw) : null
    // Номер другой страны без лишнего текста — как вставили (с группами): страну поле поймёт по «+»
    const whole = parsed != null && (!parsed.startsWith('+') || /\p{L}/u.test(raw) || !/^\s*(\+|00)/.test(cleanPhone(raw))) ? parsed : null
    const text = whole ?? cleanPhone(raw)
    // Набрали или вставили номер с «+» — он сам говорит, какая страна
    const split = whole != null && !whole.startsWith('+')
      ? splitPhone(whole, 'KG')
      : splitPhone(/^\s*(\+|00)/.test(text) ? text : joinPhone(country, text) || '', country)
    const next = mask && atEnd ? { ...split, local: maskLocal(split.country, split.local) } : split
    setPicked(next.country)
    onChange(joinPhone(next.country, next.local))
    // Набрали номер целиком — в форме с data-advance сразу к следующему полю
    // Номер считаем без «0» и «996» в начале: «0772 666 666» — это 9 цифр номера, а не «полный» на
    // девятой цифре (иначе фокус уходил дальше, последняя цифра терялась, сервер номер отклонял)
    const need = digitCount(phoneCountry(next.country).example)
    const digits = numberDigits(next.country, next.local)
    if (need > 0 && digits === need && numberDigits(country, local) < need) focusNext(input.current)
  }

  const pick = (id: string) => {
    setPicked(id)
    onChange(joinPhone(id, local))
  }

  return (
    <div className="phone">
      <input ref={input} aria-label={label} type="tel" enterKeyHint="next" inputMode="tel" autoComplete="off" maxLength={24} placeholder={c.example}
        value={local} onChange={(e) => type(e.target.value, e.target.selectionStart == null || e.target.selectionStart >= e.target.value.length)}
        onPaste={(e) => {
          // Вставка заменяет поле целиком: «555» + вставленный «+996 555 …» не должны слиться в один номер
          const pasted = e.clipboardData?.getData('text') ?? ''
          if (phoneFromText(pasted) == null) return
          e.preventDefault()
          type(pasted, true, true)
        }} />
      <Select aria-label="Код страны" value={country} onChange={(e) => pick(e.target.value)}>
        {[...PHONE_COUNTRIES, OTHER_COUNTRY].map((o) => (
          <option key={o.id} value={o.id}>{`${o.flag} +${o.code} · ${o.name}`}</option>
        ))}
      </Select>
    </div>
  )
}
