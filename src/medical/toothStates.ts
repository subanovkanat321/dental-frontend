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
