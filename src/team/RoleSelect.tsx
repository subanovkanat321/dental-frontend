import { Select } from '../layout/Select'
import { HIDDEN_CHOICE, ROLE_CHOICES, type RoleChoice } from './staffRoles'

/**
 * Поле «Роль» — наш выпадающий список (на телефоне лист снизу): только допустимые сочетания, у каждого
 * серым — что роль может. hideable — ещё «Врач скрыт» (карточка врача без роли в клинике).
 */
export function RoleSelect({ value, onChange, isDisabled, hideable = false }: {
  value: RoleChoice
  onChange: (choice: RoleChoice) => void
  /** Пункт есть, но выбрать нельзя (например, роль в клинике тому, кто ещё не вошёл) */
  isDisabled?: (choice: RoleChoice) => boolean
  hideable?: boolean
}) {
  const choices = hideable || value === 'HIDDEN' ? [...ROLE_CHOICES, HIDDEN_CHOICE] : ROLE_CHOICES
  return (
    <Select aria-label="Роль" value={value} onChange={(e) => onChange(e.target.value as RoleChoice)}>
      {choices.map(([choice, label, hint]) => (
        <option key={choice} value={choice} disabled={isDisabled?.(choice)}>{label} · {hint}</option>
      ))}
    </Select>
  )
}
