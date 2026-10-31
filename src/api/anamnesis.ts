import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from './client'

/** Анкета пациента — медданные: видят врач его приёмов и админ (проверяет сервер, иначе 403). */
export function useAnamnesis(patientId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['anamnesis', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/anamnesis', { params: { path: { patientId: patientId! } } })),
    enabled: enabled && patientId != null,
    retry: false,
  })
}
