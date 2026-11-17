import { useState } from 'react'

import type { Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { useDeleteOrder, useOrderStatus, usePay, type LabOrder } from './api'
import { PayDialog, ReworkDialog } from './LabDialogs'
import { LabOrderDialog } from './LabOrderDialog'
import type { LabActions } from './LabRow'

type Me = Schemas['BookingViewsMe']

/**
 * Действия со строкой заказа и их окна (изменить, переделка, оплата) — одни для раздела «Лаборатория» и карточки
 * пациента. Возвращает обработчики для LabRow, окна (`dialogs`) и ошибку последнего действия.
 */
export function useLabActions(me: Me, onOpenPatient?: (patientId: number) => void) {
  const status = useOrderStatus()
  const pay = usePay()
  const remove = useDeleteOrder()
  const [editing, setEditing] = useState<LabOrder | null>(null)
  const [rework, setRework] = useState<LabOrder | null>(null)
  const [paying, setPaying] = useState<LabOrder | null>(null)

  const actions: LabActions = {
    onEdit: setEditing,
    onStatus: (o, s) => status.mutate({ id: o.id, status: s }),
    onRework: setRework,
    onPay: setPaying,
    onUnpay: async (o) => {
      if (await ask(`Отменить оплату технику${o.expenseId ? ' и удалить расход' : ''}?`, { ok: 'Отменить оплату', danger: true })) {
        pay.mutate({ id: o.id, paid: false })
      }
    },
    onOpenPatient,
    onDelete: async (o) => {
      if (await ask(`Удалить заказ «${o.work}» — ${o.patientName}?`, { ok: 'Удалить', danger: true })) remove.mutate(o.id)
    },
  }
  const error = status.error ?? pay.error ?? remove.error
  const dialogs = (
    <>
      {editing && <LabOrderDialog key={editing.id} me={me} order={editing} onClose={() => setEditing(null)} />}
      {rework && <ReworkDialog order={rework} onClose={() => setRework(null)} />}
      {paying && <PayDialog order={paying} onClose={() => setPaying(null)} />}
    </>
  )
  return { actions, dialogs, error, busyId: status.isPending ? status.variables?.id : undefined }
}
