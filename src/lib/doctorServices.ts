import type { Schemas } from '../api/client'

type Links = Schemas['DoctorServicesView'][] | undefined

/** Услуги, выбранные у врача (V90); null — не выбирали: врач оказывает все услуги клиники. */
export function chosenServiceIds(links: Links, doctorId: number | null | undefined): number[] | null {
  const ids = links?.find((l) => l.doctorId === doctorId)?.serviceTypeIds
  return ids?.length ? ids : null
}

/**
 * Услуги, на которые можно записать к врачу: выбраны у него — только они, нет — все. keep —
 * услуга, которая уже стоит у приёма: её не прячем, даже если врачу её потом убрали.
 */
export function servicesOfDoctor<T extends { id?: number }>(services: T[], links: Links, doctorId: number | null | undefined, keep?: number | ''): T[] {
  const ids = chosenServiceIds(links, doctorId)
  return ids ? services.filter((s) => ids.includes(s.id!) || (keep !== undefined && keep !== '' && s.id === keep)) : services
}
