import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { WEEK } from './texts'

export type Chair = Schemas['ChairOverview']
type Conflict = { startAt?: string; endAt?: string; doctorName?: string; otherStartAt?: string; otherEndAt?: string; otherDoctorName?: string }

/**
 * Кресла клиники (V185): кто за каким креслом и где часы врачей одного кресла пересекаются. Один запрос
 * на CRM (кэш общий у «Расписания» и «Персонала»). Только для сотрудников: пациентам про кресла не говорим.
 */
export function useChairs(enabled = true) {
  return useQuery({
    queryKey: ['chairs'],
    queryFn: () => unwrap(api.GET('/api/chairs')),
    staleTime: 60_000,
    enabled,
  })
}

/** Кресло врача; нет — null (без кресла — как раньше, ограничение только по врачу). */
export function chairOf(chairs: Chair[] | undefined, doctorId: number | undefined): Chair | null {
  return (chairs ?? []).find((c) => (c.doctorIds ?? []).includes(doctorId ?? -1)) ?? null
}

/** «делит кресло с: Айгерим, Бакыт» — имена соседей по креслу; одному врачу в кресле — null. */
export function sharesText(chair: Chair | null, doctorId: number | undefined, nameOf: (id: number) => string): string | null {
  const mates = (chair?.doctorIds ?? []).filter((id) => id !== doctorId).map(nameOf).filter(Boolean)
  return mates.length ? `делит кресло с: ${mates.join(', ')}` : null
}

/**
 * Подсказки о пересечении часов работы с соседями по креслу — не запрет: записи всё равно не пересекутся
 * (это держит сервер), но так врачам удобнее. «часы пересекаются с Айгерим по вт 10:00–14:00».
 */
export function overlapTexts(chair: Chair | null, doctorId: number | undefined, nameOf: (id: number) => string): string[] {
  return (chair?.overlaps ?? [])
    .filter((o) => o.doctorId === doctorId || o.otherDoctorId === doctorId)
    .map((o) => {
      const other = o.doctorId === doctorId ? o.otherDoctorId : o.doctorId
      const day = (WEEK.find(([code]) => code === o.weekday)?.[2] ?? '').toLowerCase()
      return `часы пересекаются с ${nameOf(other)} по ${day} ${o.start!.slice(0, 5)}–${o.end!.slice(0, 5)}`
    })
}

/** Пересечения приёмов из ответа 409 «chair-conflicts» (без пациентов: время и врачи). */
export function conflictsOf(problem: Readonly<Record<string, unknown>>): Conflict[] {
  return Array.isArray(problem.conflicts) ? (problem.conflicts as Conflict[]) : []
}
