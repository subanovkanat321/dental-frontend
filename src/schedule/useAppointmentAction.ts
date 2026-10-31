import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

/** Что сделать с приёмом: у каждого действия свой адрес и тело — как в AppointmentController. */
export type Action =
  | { kind: 'status'; body: Schemas['AppointmentRequestsChangeStatus'] }
  | { kind: 'payment'; body: Schemas['AppointmentControllerPayment'] }
  | { kind: 'extra'; body: Schemas['AppointmentControllerExtra'] }
  | { kind: 'bill'; body: Schemas['AppointmentControllerBill'] }
  | { kind: 'reschedule'; body: Schemas['AppointmentRequestsReschedule'] }
  | { kind: 'transfer'; body: Schemas['AppointmentRequestsTransfer'] }
  | { kind: 'service'; body: Schemas['AppointmentRequestsService'] }
  | { kind: 'comment'; body: Schemas['AppointmentRequestsComment'] }
  | { kind: 'reply'; body: Schemas['AppointmentRequestsChangeReply'] }
  | { kind: 'remindTelegram' }

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
    case 'reschedule':
      return unwrap(api.POST('/api/appointments/{id}/reschedule', { ...path, body: action.body }))
    case 'transfer':
      return unwrap(api.POST('/api/appointments/{id}/transfer', { ...path, body: action.body }))
    case 'service':
      return unwrap(api.PUT('/api/appointments/{id}/service', { ...path, body: action.body }))
    case 'comment':
      return unwrap(api.PUT('/api/appointments/{id}/comment', { ...path, body: action.body }))
    case 'reply':
      return unwrap(api.POST('/api/appointments/{id}/reply', { ...path, body: action.body }))
    case 'remindTelegram':
      return unwrap(api.POST('/api/appointments/{id}/remind-telegram', path))
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
      client.setQueryData(['appointment', updated.id], updated)
      // Оплата и статус меняют и «Кассу», и карточку пациента — перечитать всё, что на экране
      for (const key of ['appointments', 'to-pay', 'debts', 'revenue', 'patient-card']) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
    onError: (error) => {
      if (error.status === 409) void client.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}
