import type { Schemas } from '../api/client'
import { childText } from '../lib/age'
import { guardianLine } from '../lib/guardian'

/**
 * Ребёнок и его представитель — в шапке карточки пациента и приёма: бейдж «Ребёнок, 7 лет» (по дате рождения,
 * до 18 лет) и строка «Представитель: мама, Айгуль, +996 …» (V164 бэкенда). Ни того ни другого — ничего.
 */
export function KidInfo({ patient }: { patient?: Schemas['PatientView'] | null }) {
  const child = childText(patient?.birthDate)
  const line = guardianLine(patient)
  if (!child && !line) return null
  return (
    <p className="kid-info">
      {child && <span className="chip small kid-badge">{child}</span>}
      {line && <span className="hint">{line}</span>}
    </p>
  )
}
