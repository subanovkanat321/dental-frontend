import type { Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']

/** Ассистент врача (V68): закреплён за врачами, денег и настроек не видит. */
export function isAssistant(me: Me): boolean {
  return (me.assistantOf?.length ?? 0) > 0
}

/**
 * Менять расписание врача: админ, регистратура, сам врач и его ассистент. Тот же список, что на
 * сервере (Staff.requireCanEdit): здесь — только чтобы не показывать кнопки, которые сервер отклонит.
 */
export function canEditDoctor(me: Me, doctorId: number | null | undefined): boolean {
  if (doctorId == null) return false
  return Boolean(me.admin || me.reception || doctorId === me.doctorId || me.assistantOf?.includes(doctorId))
}
