import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'

export type LabOrder = Schemas['LabOrderView']
export type LabOrderDraft = Schemas['LabOrderDraft']
export type Lab = Schemas['LabView']
export type LabDraft = Schemas['LabDraft']
export type LabStatus = LabOrder['status']
export type LabKind = LabOrder['kind']

/** Все запросы «Лаборатории» — под одним ключом: изменили заказ — обновились раздел, карточки пациента и приёма и долги. */
export const LAB = ['lab'] as const

export type OrderFilter = { fitted?: boolean; labId?: number; doctorId?: number; patientId?: number; appointmentId?: number }

export function useLabOrders(params: OrderFilter, enabled = true) {
  return useQuery({
    queryKey: [...LAB, 'orders', params],
    queryFn: () => unwrap(api.GET('/api/lab-orders', { params: { query: params } })),
    enabled,
  })
}

export function useLabOrder(id: number | undefined) {
  return useQuery({
    queryKey: [...LAB, 'order', id],
    queryFn: () => unwrap(api.GET('/api/lab-orders/{id}', { params: { path: { id: id! } } })),
    enabled: id != null,
  })
}

/** Справочник лабораторий; all — и убранные из списка (нужны старым заказам). */
export function useLabs(all = false, enabled = true) {
  return useQuery({
    queryKey: [...LAB, 'labs', all],
    queryFn: () => unwrap(api.GET('/api/labs', { params: { query: { all } } })),
    enabled,
    staleTime: 60_000,
  })
}

/** «Должны лабораториям» — только тем, кто видит расходы (сервер иначе 403). */
export function useLabDebts(enabled: boolean) {
  return useQuery({
    queryKey: [...LAB, 'debts'],
    queryFn: () => unwrap(api.GET('/api/lab-orders/debts')),
    enabled,
  })
}

/** Будущие приёмы пациента — выбрать примерку. */
export function useVisits(patientId: number | undefined) {
  return useQuery({
    queryKey: [...LAB, 'visits', patientId],
    queryFn: () => unwrap(api.GET('/api/lab-orders/visits', { params: { query: { patientId: patientId! } } })),
    enabled: patientId != null,
  })
}

function useInvalidate() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: LAB })
}

/** Создать (id нет) или изменить заказ. */
export function useSaveOrder() {
  const done = useInvalidate()
  return useMutation<LabOrder, ApiError, { id?: number; body: LabOrderDraft }>({
    mutationFn: ({ id, body }) => unwrap(id == null
      ? api.POST('/api/lab-orders', { body })
      : api.PUT('/api/lab-orders/{id}', { params: { path: { id } }, body })),
    onSuccess: done,
  })
}

export function useOrderStatus() {
  const done = useInvalidate()
  return useMutation<LabOrder, ApiError, { id: number; status: LabStatus; reason?: string; dueOn?: string }>({
    mutationFn: ({ id, ...body }) => unwrap(api.POST('/api/lab-orders/{id}/status', { params: { path: { id } }, body })),
    onSettled: done,
  })
}

/** «Оплатить технику» (expense — записать расход) и «Отменить оплату». */
export function usePay() {
  const client = useQueryClient()
  return useMutation<LabOrder, ApiError, { id: number; paid: boolean; expense?: boolean }>({
    mutationFn: ({ id, paid, expense }) => unwrap(paid
      ? api.POST('/api/lab-orders/{id}/pay', { params: { path: { id } }, body: { expense } })
      : api.DELETE('/api/lab-orders/{id}/pay', { params: { path: { id } } })),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: LAB })
      // Расход появился или пропал — «Расходы» в «Кассе»
      void client.invalidateQueries({ queryKey: ['expenses'] })
    },
  })
}

export function useDeleteOrder() {
  const done = useInvalidate()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/lab-orders/{id}', { params: { path: { id } } })),
    onSettled: done,
  })
}

export function useSaveLab() {
  const done = useInvalidate()
  return useMutation<Lab, ApiError, { id?: number; body: LabDraft }>({
    mutationFn: ({ id, body }) => unwrap(id == null
      ? api.POST('/api/labs', { body })
      : api.PUT('/api/labs/{id}', { params: { path: { id } }, body })),
    onSuccess: done,
  })
}

export function useArchiveLab() {
  const done = useInvalidate()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/labs/{id}', { params: { path: { id } } })),
    onSettled: done,
  })
}
