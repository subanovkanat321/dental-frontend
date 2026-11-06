import type { Schemas } from '../api/client'
import { formatPhone } from './time'

type Patient = Schemas['PatientView']
export type GuardianRelation = NonNullable<Schemas['Guardian']['relation']>

/** Кем представитель приходится пациенту (V164 бэкенда) — в строке «Представитель: мама, Айгуль, …». */
export const GUARDIAN_RELATION: Record<GuardianRelation, string> = {
  MOTHER: 'мама', FATHER: 'папа', GRANDMOTHER: 'бабушка', GRANDFATHER: 'дедушка', GUARDIAN: 'опекун', OTHER: 'другой',
}

/** Куда писать о записи: номер представителя, нет своего — номер карточки; без представителя — номер пациента. */
export function contactPhone(p?: Pick<Patient, 'phone' | 'guardian'> | null): string | undefined {
  return p?.guardian?.phone ?? p?.phone ?? undefined
}

/** «Представитель: мама, Айгуль, +996 700 164 001»; без представителя — null. */
export function guardianLine(p?: Pick<Patient, 'phone' | 'guardian'> | null): string | null {
  const g = p?.guardian
  if (!g) return null
  const phone = contactPhone(p)
  const who = g.relation && g.relation !== 'OTHER' ? `${GUARDIAN_RELATION[g.relation]}, ` : ''
  return `Представитель: ${who}${g.fullName}${phone ? `, ${formatPhone(phone)}` : ''}`
}
