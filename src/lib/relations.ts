import type { Schemas } from '../api/client'

type Relation = NonNullable<Schemas['FamiliesMember']['relation']>

/** Кем член семьи приходится тому, кто добавил его из бота: «Аружан · ребёнок». */
export const RELATION: Record<Relation, string> = {
  CHILD: 'ребёнок', SPOUSE: 'супруг(а)', PARENT: 'родитель', SIBLING: 'брат или сестра', OTHER: 'родственник',
}

/** Обратное — кем записавший приходится пациенту: записала мама ребёнка (CHILD) — «родитель». */
const BOOKER: Record<Relation, string> = {
  CHILD: 'родитель', SPOUSE: 'супруг(а)', PARENT: 'сын или дочь', SIBLING: 'брат или сестра', OTHER: 'родственник',
}

/** «Записал(а) через бота: Садыкова Айгуль, родитель» — в карточке приёма. */
export function bookedByText(b: Schemas['FamiliesBooker']): string {
  return `Записал(а) через бота: ${b.fullName}${b.relation ? `, ${BOOKER[b.relation]}` : ''}`
}
