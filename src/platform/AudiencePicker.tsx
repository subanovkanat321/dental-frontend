import { useMemo, useState } from 'react'

import type { Audience } from './agreementTarget'

type Clinic = { id?: number; name?: string }

/**
 * Кому адресована версия договора: «Всем клиникам» или «Выбранным» — поиск и галочки.
 * Клиники, которым версия не адресована (и не назначена), не видят требования подписать.
 */
export function AudiencePicker({ clinics, value, onChange, disabled }: {
  clinics: Clinic[]
  value: Audience
  onChange: (next: Audience) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const chosen = useMemo(() => new Set(value.clinicIds), [value.clinicIds])
  const q = query.trim().toLowerCase()
  const shown = q ? clinics.filter((c) => (c.name ?? '').toLowerCase().includes(q)) : clinics
  const toggle = (id: number) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ all: false, clinicIds: [...next] })
  }
  return (
    <fieldset className="form" disabled={disabled} aria-label="Кому адресован договор">
      <div className="segments" role="group" aria-label="Кому">
        <button type="button" aria-pressed={value.all} onClick={() => onChange({ all: true, clinicIds: [] })}>Всем клиникам ({clinics.length})</button>
        <button type="button" aria-pressed={!value.all} onClick={() => onChange({ all: false, clinicIds: value.clinicIds })}>Выбранным клиникам{value.all ? '' : ` (${chosen.size})`}</button>
      </div>
      {!value.all && (
        <>
          <label className="field"><span>Найти клинику</span>
            <input type="search" value={query} placeholder="Название" onChange={(e) => setQuery(e.target.value)} /></label>
          <div className="checks">
            {shown.map((c) => (
              <label key={c.id} className="check"><input type="checkbox" checked={chosen.has(c.id!)} onChange={() => toggle(c.id!)} /> {c.name}</label>
            ))}
            {!shown.length && <p className="hint">Ничего не нашлось</p>}
          </div>
        </>
      )}
    </fieldset>
  )
}
