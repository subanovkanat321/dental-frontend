import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

/** Почему похожи — серой строкой. */
export function reasonText(reason: Schemas['PatientDuplicatesMatch']['reason']): string {
  return reason === 'PHONE' ? 'тот же номер, похожее имя' : 'то же имя и дата рождения'
}

/** Похожие карточки пациента — для шапки карточки и окна объединения. */
export function useDuplicates(patientId: number, enabled = true) {
  return useQuery({
    queryKey: ['duplicates', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/duplicates', { params: { path: { patientId } } })),
    enabled,
    retry: false,
  })
}

/** Пары похожих карточек клиники — только руководителю (сервер другим ответит 403). */
export function useDuplicatePairs(enabled: boolean) {
  return useQuery({
    queryKey: ['duplicates', 'all'],
    queryFn: () => unwrap(api.GET('/api/patients/duplicates')),
    enabled,
    retry: false,
  })
}
