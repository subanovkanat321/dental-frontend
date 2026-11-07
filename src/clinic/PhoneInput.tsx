import { useRef, useState } from 'react'

import { Select } from '../layout/Select'
import { focusNext, phoneDigits } from '../lib/advance'
import { OTHER_COUNTRY, PHONE_COUNTRIES } from '../lib/phone'
import { cleanPhone, joinPhone, maskLocal, phoneCountry, splitPhone } from './phone'

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

  const type = (raw: string, atEnd = false) => {
    const text = cleanPhone(raw)
    // Набрали или вставили номер с «+» — он сам говорит, какая страна
    const split = splitPhone(/^\s*(\+|00)/.test(text) ? text : joinPhone(country, text) || '', country)
    const next = mask && atEnd ? { ...split, local: maskLocal(split.country, split.local) } : split
    setPicked(next.country)
    onChange(joinPhone(next.country, next.local))
    // Набрали номер целиком — в форме с data-advance сразу к следующему полю
    // Номер считаем без «0» и «996» в начале: «0772 666 666» — это 9 цифр номера, а не «полный» на
    // девятой цифре (иначе фокус уходил дальше, последняя цифра терялась, сервер номер отклонял)
    const need = phoneDigits(phoneCountry(next.country).example)
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
        value={local} onChange={(e) => type(e.target.value, e.target.selectionStart == null || e.target.selectionStart >= e.target.value.length)} />
      <Select aria-label="Код страны" value={country} onChange={(e) => pick(e.target.value)}>
        {[...PHONE_COUNTRIES, OTHER_COUNTRY].map((o) => (
          <option key={o.id} value={o.id}>{`${o.flag} +${o.code} · ${o.name}`}</option>
        ))}
      </Select>
    </div>
  )
}
