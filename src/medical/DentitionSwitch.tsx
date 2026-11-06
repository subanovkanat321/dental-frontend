import { ageYears, yearsText } from '../lib/age'
import { DENTITIONS, type Dentition } from './dentition'

/**
 * Переключатель прикуса над картой зубов: «Постоянные / Молочные / Сменный». Не выбирали — прикус по возрасту
 * (подпись «по возрасту, 7 лет»); выбрали — «↺ по возрасту» вернёт расчёт по дате рождения.
 *
 * @param saved выбранный у пациента прикус; null — по возрасту
 * @param onChange null — снова по возрасту
 */
export function DentitionSwitch({ value, saved, birthDate, onChange, disabled }: {
  value: Dentition
  saved: Dentition | null
  birthDate?: string | null
  onChange: (d: Dentition | null) => void
  disabled?: boolean
}) {
  const years = ageYears(birthDate)
  return (
    <div className="dentition-switch">
      <div className="segments" role="group" aria-label="Прикус">
        {DENTITIONS.map(([key, title]) => (
          <button key={key} type="button" aria-pressed={value === key} disabled={disabled}
            onClick={() => onChange(key === saved ? null : key)}>{title}</button>
        ))}
      </div>
      {saved == null
        ? <span className="hint small">по возрасту{years != null ? `, ${yearsText(years)}` : ' (дата рождения не указана)'}</span>
        : <button type="button" className="link small" disabled={disabled} onClick={() => onChange(null)}>↺ по возрасту</button>}
    </div>
  )
}
