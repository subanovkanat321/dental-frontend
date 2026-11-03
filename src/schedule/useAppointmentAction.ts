import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'

type Appointment = Schemas['AppointmentView']

/** Что сделать с приёмом: у каждого действия свой адрес и тело — как в AppointmentController. */
type Action =
  | { kind: 'status'; body: Schemas['AppointmentRequestsChangeStatus'] }
  | { kind: 'payment'; body: Schemas['AppointmentControllerPayment'] }
  | { kind: 'extra'; body: Schemas['AppointmentControllerExtra'] }
  | { kind: 'bill'; body: Schemas['AppointmentControllerBill'] }
  | { kind: 'charge'; body: Schemas['AppointmentControllerBill'] }
  | { kind: 'reschedule'; body: Schemas['AppointmentRequestsReschedule'] }
  | { kind: 'transfer'; body: Schemas['AppointmentRequestsTransfer'] }
  | { kind: 'service'; body: Schemas['AppointmentRequestsService'] }
  | { kind: 'comment'; body: Schemas['AppointmentRequestsComment'] }
  | { kind: 'promo'; body: Schemas['AppointmentRequestsPromoCode'] }
  | { kind: 'reply'; body: Schemas['AppointmentRequestsChangeReply'] }
  | { kind: 'remindTelegram' }
  | { kind: 'deposit'; body: Schemas['DepositControllerAction'] }
  | { kind: 'undo'; body: Schemas['AppointmentRequestsUndo'] }

/** Отправить действие над приёмом — ответ сервера: свежий приём. */
export function sendAppointmentAction(id: number, action: Action): Promise<Appointment> {
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
    case 'charge':
      return unwrap(api.POST('/api/appointments/{id}/payment/charge', { ...path, body: action.body }))
    case 'reschedule':
      return unwrap(api.POST('/api/appointments/{id}/reschedule', { ...path, body: action.body }))
    case 'transfer':
      return unwrap(api.POST('/api/appointments/{id}/transfer', { ...path, body: action.body }))
    case 'service':
      return unwrap(api.PUT('/api/appointments/{id}/service', { ...path, body: action.body }))
    case 'comment':
      return unwrap(api.PUT('/api/appointments/{id}/comment', { ...path, body: action.body }))
    case 'promo':
      return unwrap(api.PUT('/api/appointments/{id}/promo-code', { ...path, body: action.body }))
    case 'reply':
      return unwrap(api.POST('/api/appointments/{id}/reply', { ...path, body: action.body }))
    case 'remindTelegram':
      return unwrap(api.POST('/api/appointments/{id}/remind-telegram', path))
    case 'undo':
      return unwrap(api.POST('/api/appointments/{id}/undo', { ...path, body: action.body }))
    case 'deposit':
      return unwrap(api.POST('/api/appointments/{id}/deposit', { ...path, body: action.body }))
  }
}

/**
 * Что зависит от приёмов: день и окна врачей, счётчики дней, «Касса» (к оплате, долги, выручка,
 * отчёт, статистика, источники, зарплата) и карточка пациента. После записи, действия и удаления
 * приёма перечитываем всё это — открытые экраны покажут свежее без F5.
 */
const APPOINTMENT_DATA = ['appointments', 'slots', 'counts', 'to-pay', 'debts', 'revenue', 'report', 'stats', 'sources', 'promo-report', 'salaries', 'patient-card']

export function refreshAppointmentData(client: QueryClient, extra: string[] = []): void {
  for (const key of [...APPOINTMENT_DATA, ...extra]) void client.invalidateQueries({ queryKey: [key] })
}

/**
 * Действие над приёмом и обновление расписания. Ответ сервера — свежий приём: кладём его в кэш
 * дня, чтобы карточка и колонка сразу показали новое, и перечитываем день на всякий случай.
 * 409 «stale» — приём успели изменить с другого устройства: перечитываем и просим повторить.
 */
export function useAppointmentAction(a: Appointment) {
  const client = useQueryClient()
  return useMutation<Appointment, ApiError, Action>({
    mutationFn: (action) => sendAppointmentAction(a.id!, action),
    onSuccess: (updated) => applyUpdatedAppointment(client, updated),
    onError: (error) => rereadOnConflict(client, error),
  })
}

/**
 * Свежий приём из ответа — в кэш дней и недель (карточка и колонка сразу показывают новое) и в
 * ['appointment', id]. Оплата и статус меняют и «Кассу» с отчётом, и карточку пациента — перечитать
 * всё, что на экране; перенос и отмена освобождают и занимают время — свободные окна и счётчики тоже.
 */
export function applyUpdatedAppointment(client: QueryClient, updated: Appointment): void {
  client.setQueriesData<Appointment[]>({ queryKey: ['appointments'] }, (day) =>
    day?.map((x) => (x.id === updated.id ? updated : x)))
  client.setQueryData(['appointment', updated.id], updated)
  refreshAppointmentData(client)
}

/** 409: время заняли или приём успели изменить с другого устройства — перечитать расписание. */
export function rereadOnConflict(client: QueryClient, error: ApiError): void {
  if (error.status === 409) {
    void client.invalidateQueries({ queryKey: ['appointments'] })
    void client.invalidateQueries({ queryKey: ['slots'] })
  }
}
