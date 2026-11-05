import type { Schemas } from '../api/client'

export type ToothState = NonNullable<Schemas['ToothView']['state']>

/** Поверхность зуба (V161): код в API латиницей, по-русски — {@link surfaceLetter}. */
export type Surface = NonNullable<Schemas['ToothView']['surfaces']>[number]

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

/** Порядок записи, как пишут врачи: «МОД», а не «ДОМ». */
export const SURFACES: Surface[] = ['M', 'O', 'D', 'B', 'L']

/** Поверхности отмечают только у кариеса, лечения и пломбы: коронка, имплант и удалённый — весь зуб (сервер очищает). */
export const WITH_SURFACES: readonly ToothState[] = ['CARIES', 'TREATING', 'FILLING']

export function hasSurfaces(state?: ToothState | null): boolean {
  return state != null && WITH_SURFACES.includes(state)
}

/** Резцы и клыки (позиции 1–3): вместо окклюзионной — режущий край. */
function isFront(n: number): boolean {
  return n % 10 <= 3
}

function isUpper(n: number): boolean {
  const q = Math.floor(n / 10)
  return q === 1 || q === 2 || q === 5 || q === 6
}

/** Буква поверхности по-русски: О (у передних — Р), М, Д, В, Я (нижние) / Н (верхние). Без номера — общая «Я/Н». */
export function surfaceLetter(s: Surface, n?: number): string {
  switch (s) {
    case 'M': return 'М'
    case 'O': return n == null ? 'О' : isFront(n) ? 'Р' : 'О'
    case 'D': return 'Д'
    case 'B': return 'В'
    case 'L': return n == null ? 'Я/Н' : isUpper(n) ? 'Н' : 'Я'
  }
}

/** Полное название — для подсказок и скринридера. */
export function surfaceName(s: Surface, n?: number): string {
  switch (s) {
    case 'M': return 'мезиальная'
    case 'O': return n == null ? 'окклюзионная (режущий край)' : isFront(n) ? 'режущий край' : 'окклюзионная'
    case 'D': return 'дистальная'
    case 'B': return n == null ? 'вестибулярная' : isFront(n) ? 'вестибулярная (губная)' : 'вестибулярная (щёчная)'
    case 'L': return n == null ? 'оральная (язычная / нёбная)' : isUpper(n) ? 'нёбная' : 'язычная'
  }
}

/** «МО», «РД», «ОН» — в порядке записи; пусто — ''. */
export function surfacesText(n: number, surfaces?: readonly Surface[] | null): string {
  if (!surfaces?.length) return ''
  return SURFACES.filter((s) => surfaces.includes(s)).map((s) => surfaceLetter(s, n)).join('')
}

/** «Кариес (МО)» — состояние со стандартной записью поверхностей. */
export function stateText(n: number, state: ToothState, surfaces?: readonly Surface[] | null): string {
  const parts = hasSurfaces(state) ? surfacesText(n, surfaces) : ''
  return `${TOOTH_STATES[state][0]}${parts ? ` (${parts})` : ''}`
}

/** Что сделали с зубом на приёме: «36 · Пломба (МО) · светоотверждаемая» — в карточке приёма, истории и «Продолжении лечения». */
export function visitToothText(t: Schemas['VisitToothView'], withNote = true): string {
  const n = t.number ?? 0
  return [t.number, stateText(n, t.state ?? 'HEALTHY', t.surfaces), withNote ? t.note : null].filter(Boolean).join(' · ')
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** Какая поверхность с какой стороны кружка у зуба n (FDI). */
export function surfaceLayout(n?: number): Record<Side, Surface> {
  const q = n == null ? 0 : Math.floor(n / 10)
  const upper = n == null || q === 1 || q === 2 || q === 5 || q === 6
  // Правая сторона пациента (четверти 1 и 4) — слева на экране: середина ряда от неё справа
  const patientRight = q === 1 || q === 4 || q === 5 || q === 8
  return {
    top: upper ? 'B' : 'L',
    bottom: upper ? 'L' : 'B',
    left: patientRight ? 'D' : 'M',
    right: patientRight ? 'M' : 'D',
  }
}
