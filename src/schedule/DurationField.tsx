import { useState } from 'react'

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240]

/**
 * Длительность приёма: частые значения списком и «Своя…» — любое число минут (20, 40, 50…),
 * как в прежнем приложении. Сервер проверяет границы сам.
 */
export function DurationField({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const [chosen, setCustom] = useState(false)
  // Значение не из списка (услуга на 20 минут, прошлый приём на 50) — сразу полем
  const custom = chosen || !DURATIONS.includes(value)
  // Текст поля — свой: стёрли число, чтобы вписать новое, — поле пустое, а не прежнее значение
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    if (Number(text) !== value) setText(String(value))
  }
  return (
    <label className="field">
      <span>Длительность</span>
      {custom ? (
        <span className="duration-custom">
          <input type="number" min={5} max={480} step={5} inputMode="numeric" aria-label="Длительность, мин" value={text}
            onChange={(e) => {
              setText(e.target.value)
              const n = Number(e.target.value)
              if (n > 0) onChange(n)
            }} />
          <span className="hint">мин</span>
          {DURATIONS.includes(value) && <button type="button" className="link" onClick={() => setCustom(false)}>списком</button>}
        </span>
      ) : (
        <select aria-label="Длительность" value={value} onChange={(e) => {
          if (e.target.value === 'custom') setCustom(true)
          else onChange(Number(e.target.value))
        }}>
          {DURATIONS.map((d) => <option key={d} value={d}>{d} мин</option>)}
          <option value="custom">Своя…</option>
        </select>
      )}
    </label>
  )
}
