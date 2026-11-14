import { chairOf, sharesText, type Chair } from './chairs'

/** Линейный значок кресла (вместо эмодзи 🪑 — DESIGN.md → Don'ts): цвет — текущий цвет текста. */
export function ChairIcon() {
  return (
    <svg className="chair-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v8h10M7 12l-1 8M17 12l1 8M7 16h10M10 4h-3" />
    </svg>
  )
}

/** Значок «Кресло 1» у врача с подсказкой «делит кресло с: Айгерим, Бакыт»; без кресла — ничего. */
export function ChairBadge({ chairs, doctorId, nameOf }: { chairs: Chair[] | undefined; doctorId: number | undefined; nameOf: (id: number) => string }) {
  const chair = chairOf(chairs, doctorId)
  if (!chair) return null
  const shares = sharesText(chair, doctorId, nameOf)
  return (
    <span className="chair-badge" title={shares ?? `${chair.name} — только у этого врача`} aria-label={`${chair.name}${shares ? `, ${shares}` : ''}`}>
      <ChairIcon /> {chair.name}
    </span>
  )
}
