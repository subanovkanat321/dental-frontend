import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type ApiError, type Schemas } from '../../api/client'

export type PurchaseList = Schemas['PurchaseViewsPurchaseList']
export type DraftGroup = Schemas['PurchaseViewsDraftGroup']
export type DraftItem = Schemas['PurchaseViewsDraftItem']
export type Order = Schemas['PurchaseViewsOrderView']
export type OrderItem = Schemas['PurchaseViewsOrderItemView']
export type Supplier = Schemas['PurchaseViewsSupplierView']
export type SupplierDraft = Schemas['PurchaseViewsSupplierDraft']

/** Все запросы «Заказа» — под одним ключом; поменяли заказ — обновились список, число у подраздела и склад. */
export const PURCHASES = ['purchases'] as const

export function usePurchases() {
  return useQuery({
    queryKey: [...PURCHASES, 'list'],
    queryFn: () => unwrap(api.GET('/api/purchases')),
  })
}

/** Число у подраздела «Склад → Заказ» — позиций к заказу; раз в 5 минут (меняется от списаний на приёмах). */
export function usePurchaseCount(enabled: boolean) {
  return useQuery({
    queryKey: [...PURCHASES, 'count'],
    queryFn: () => unwrap(api.GET('/api/purchases/count')),
    enabled,
    refetchInterval: 5 * 60_000,
  })
}

export function useSuppliers(all = false) {
  return useQuery({
    queryKey: [...PURCHASES, 'suppliers', all],
    queryFn: () => unwrap(api.GET('/api/suppliers', { params: { query: { all } } })),
    staleTime: 60_000,
  })
}

/** После изменений: «Заказ», склад («заказан», «где берём») и история цен. */
export function useRefreshPurchases() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: PURCHASES })
    void client.invalidateQueries({ queryKey: ['supplies'] })
    void client.invalidateQueries({ queryKey: ['supply-history'] })
    void client.invalidateQueries({ queryKey: ['supply-prices'] })
  }
}

/** Где обычно берём, «добавить в заказ» и своё количество (null — как предложено, 0 — не заказываем). */
export function useSupplyOrder() {
  const refresh = useRefreshPurchases()
  return useMutation<Schemas['SupplyView'], ApiError, { supplyId: number; supplierId?: number | null; wanted: boolean; quantity?: number | null }>({
    mutationFn: ({ supplyId, supplierId, wanted, quantity }) => unwrap(api.PUT('/api/supplies/{id}/order', {
      params: { path: { id: supplyId } },
      body: { supplierId: supplierId ?? undefined, wanted, quantity: quantity ?? undefined },
    })),
    onSettled: refresh,
  })
}

export function useSendOrder() {
  const refresh = useRefreshPurchases()
  return useMutation<Schemas['PurchaseViewsSent'], ApiError, { supplierId: number; items: { supplyId: number; quantity: number }[] }>({
    mutationFn: (body) => unwrap(api.POST('/api/purchases', { body })),
    onSettled: refresh,
  })
}

export function useReceive() {
  const refresh = useRefreshPurchases()
  return useMutation<Order, ApiError, { id: number; items: { itemId: number; received: number; costSom?: number }[] }>({
    mutationFn: ({ id, items }) => unwrap(api.POST('/api/purchases/{id}/receive', { params: { path: { id } }, body: { items } })),
    onSuccess: refresh,
  })
}

export function useCancelOrder() {
  const refresh = useRefreshPurchases()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/purchases/{id}', { params: { path: { id } } })),
    onSettled: refresh,
  })
}

export function useSaveSupplier() {
  const refresh = useRefreshPurchases()
  return useMutation<Supplier, ApiError, { id?: number; body: SupplierDraft }>({
    mutationFn: ({ id, body }) => unwrap(id == null
      ? api.POST('/api/suppliers', { body })
      : api.PUT('/api/suppliers/{id}', { params: { path: { id } }, body })),
    onSuccess: refresh,
  })
}

export function useArchiveSupplier() {
  const refresh = useRefreshPurchases()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/suppliers/{id}', { params: { path: { id } } })),
    onSettled: refresh,
  })
}

/** История цен материала — не ассистенту (сервер: 403). */
export function useSupplyPrices(supplyId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['supply-prices', supplyId],
    queryFn: () => unwrap(api.GET('/api/supplies/{id}/prices', { params: { path: { id: supplyId } } })),
    enabled,
  })
}

/** «17 ноября» — дата отправки или поставки, по Бишкеку. */
export function dayText(value: string): string {
  const iso = value.length === 10 ? `${value}T06:00:00Z` : value
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'long' }).format(new Date(iso))
}

/** «Композит A2 — 3 шт, Перчатки M — 2 уп» */
export function itemsText(items: { name: string; unit: string; quantity: number }[]): string {
  return items.map((i) => `${i.name} — ${i.quantity} ${i.unit}`).join(', ')
}
