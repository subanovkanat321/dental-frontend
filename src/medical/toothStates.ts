import type { Schemas } from '../api/client'

export type ToothState = NonNullable<Schemas['ToothView']['state']>

/** Состояние зуба: подпись и значок — на карте зубов и в «Проверьте» после диктовки. */
export const TOOTH_STATES: Record<ToothState, [string, string]> = {
  HEALTHY: ['Здоров', '⚪'],
  CARIES: ['Кариес', '🟤'],
  TREATING: ['Лечится', '🟠'],
  FILLING: ['Пломба', '🔵'],
  CROWN: ['Коронка', '👑'],
  IMPLANT: ['Имплант', '🔩'],
  MISSING: ['Удалён', '✖️'],
}

/** Что сделали с зубом на приёме: «36 · Пломба · светоотверждаемая» — в карточке приёма, истории и «Продолжении лечения». */
export function visitToothText(t: Schemas['VisitToothView'], withNote = true): string {
  return [t.number, TOOTH_STATES[t.state ?? 'HEALTHY'][0], withNote ? t.note : null].filter(Boolean).join(' · ')
}
