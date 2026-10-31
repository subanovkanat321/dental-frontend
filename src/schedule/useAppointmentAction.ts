import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

/** Что сделать с приёмом: у каждого действия свой адрес и тело — как в AppointmentController. */
export type Action =
  | { kind: 'status'; body: Schemas['AppointmentRequestsChangeStatus'] }
  | { kind: 'payment'; body: Schemas['AppointmentControllerPayment'] }
  | { kind: 'extra'; body: Schemas['AppointmentControllerExtra'] }
  | { kind: 'bill'; body: Schemas['AppointmentControllerBill'] }

function send(id: number, action: Action): Promise<Appointment> {
  const path = { params: { path: { id } } }
  switch (action.kind) {
    case 'status':
      return unwrap(api.POST('/api/appointments/{id}/status', { ...path, body: action.body }))
    case 'payment':
      return unwrap(api.POST('/api/appointments/{id}/payment', { ...path, body: action.body }))
    case 'extra':
      return unwrap(api.POST('/api/appointments/{id}/payment/extra', { ...path, body: action.body }))
    case 'bill':
      return unwrap(api.POST('/api/appointments/{id}/payment/bill', { ...path, body: action.body }))
  }
}

/**
 * Действие над приёмом и обновление расписания. Ответ сервера — свежий приём: кладём его в кэш
 * дня, чтобы карточка и колонка сразу показали новое, и перечитываем день на всякий случай.
 * 409 «stale» — приём успели изменить с другого устройства: перечитываем и просим повторить.
 */
export function useAppointmentAction(a: Appointment) {
  const client = useQueryClient()
  return useMutation<Appointment, ApiError, Action>({
    mutationFn: (action) => send(a.id!, action),
    onSuccess: (updated) => {
      client.setQueriesData<Appointment[]>({ queryKey: ['appointments'] }, (day) =>
        day?.map((x) => (x.id === updated.id ? updated : x)))
      void client.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (error) => {
      if (error.status === 409) void client.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}
