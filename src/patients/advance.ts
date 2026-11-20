import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { somText } from '../lib/time'

export type Advance = Schemas['AdvancesView']

/**
 * Аванс пациента (V243) — остаток его счёта (семьи, если он в семье) и история. Один ключ ['advance', id]: шапка
 * карточки, «Деньги», форма оплаты приёма и «Оплатить за семью» читают одно и то же; оплата приёма перечитывает его
 * (refreshAppointmentData).
 */
export function useAdvance(patientId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['advance', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/advance', { params: { path: { patientId: patientId! } } })),
    enabled: enabled && patientId != null,
    retry: false,
    staleTime: 30_000,
  })
}

/** «аванс 20 000» или «аванс семьи 20 000» — в шапку и в кнопку «С аванса». */
export function advanceText(a: Pick<Advance, 'balanceSom' | 'familyId'>): string {
  return `${a.familyId != null ? 'аванс семьи' : 'аванс'} ${somText(a.balanceSom)}`
}
