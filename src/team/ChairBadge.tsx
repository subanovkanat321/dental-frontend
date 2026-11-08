import { chairOf, sharesText, type Chair } from './chairs'

/** Значок «🪑 Кресло 1» у врача с подсказкой «делит кресло с: Айгерим, Бакыт»; без кресла — ничего. */
export function ChairBadge({ chairs, doctorId, nameOf }: { chairs: Chair[] | undefined; doctorId: number | undefined; nameOf: (id: number) => string }) {
  const chair = chairOf(chairs, doctorId)
  if (!chair) return null
  const shares = sharesText(chair, doctorId, nameOf)
  return (
    <span className="chair-badge" title={shares ?? `${chair.name} — только у этого врача`} aria-label={`${chair.name}${shares ? `, ${shares}` : ''}`}>
      <span aria-hidden="true">🪑</span> {chair.name}
    </span>
  )
}
