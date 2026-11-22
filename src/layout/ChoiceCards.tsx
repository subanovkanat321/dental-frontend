import type { ReactNode } from 'react'

export type Choice<T extends string> = { value: T; icon?: string; title: string; text: ReactNode }

/**
 * Выбор из двух-трёх вариантов карточками (2026-11-21, владелец: «не галочки, а что-то удобное»): у каждого варианта —
 * заголовок и что он значит простыми словами; выбранный — с рамкой и ✓. Для настроек вида «как устроена клиника»,
 * где галочка «вкл/выкл» не объясняет, что будет во втором случае.
 */
export function ChoiceCards<T extends string>({ label, value, choices, onChange, disabled }: {
  label: string
  value: T
  choices: Choice<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="choice-cards" role="radiogroup" aria-label={label}>
      {choices.map((c) => {
        const on = c.value === value
        return (
          <button key={c.value} type="button" role="radio" aria-checked={on} disabled={disabled}
            className={on ? 'choice-card on' : 'choice-card'} onClick={() => !on && onChange(c.value)}>
            <span className="choice-card-head">
              {c.icon && <span className="choice-card-ico" aria-hidden="true">{c.icon}</span>}
              <strong>{c.title}</strong>
              <span className="choice-card-mark" aria-hidden="true">{on ? '✓' : ''}</span>
            </span>
            <span className="choice-card-text">{c.text}</span>
          </button>
        )
      })}
    </div>
  )
}
