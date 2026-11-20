import type { Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']

/** Текст 403 правила дня — и подсказка у замка. */
export const LOCKED_HINT = '🔒 изменить может руководитель'

/** Приём заперт для меня: состоявшийся прошлого дня, клиника разрешает врачам только в день приёма; руководителю — нет. */
export function lockedForMe(a: Appointment, me: Me): boolean {
  return Boolean(a.lockedForDoctors) && !me.admin
}

/** «Профгигиена +1» — день, неделя, подсказка у записи; одна услуга — её название. */
export function serviceLabel(a: Pick<Appointment, 'serviceName' | 'services'>): string | undefined {
  const more = (a.services?.length ?? 0) - 1
  if (!a.serviceName) return undefined
  return more > 0 ? `${a.serviceName} +${more}` : a.serviceName
}

/** «36, 37» → [36, 37]; пусто — []; не номер — null. */
export function parseTeeth(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean)
  const numbers = parts.map(Number)
  return numbers.some((n) => !Number.isInteger(n)) ? null : numbers
}
