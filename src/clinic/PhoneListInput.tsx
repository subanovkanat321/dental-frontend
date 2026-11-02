import { PhoneInput } from './PhoneInput'
import { MAX_PHONES } from './phone'

/**
 * Несколько телефонов для звонка, до трёх: первый — главный, «＋ Ещё номер» добавляет поле, ✕ убирает.
 * WhatsApp — отдельным полем рядом: у многих он на другом номере.
 */
export function PhoneListInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const set = (i: number, v: string) => onChange(values.map((x, j) => (j === i ? v : x)))
  return (
    <div className="phone-list">
      {values.map((v, i) => (
        <div key={i} className="phone-list-row">
          <PhoneInput label={i === 0 ? label : `${label} ${i + 1}`} value={v} onChange={(next) => set(i, next)} />
          {values.length > 1 && (
            <button type="button" className="btn ghost" aria-label={`Убрать номер ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>✕</button>
          )}
        </div>
      ))}
      {values.length < MAX_PHONES && (
        <button type="button" className="btn ghost small add-phone" onClick={() => onChange([...values, ''])}>＋ Ещё номер</button>
      )}
    </div>
  )
}
