import { CalmRow, RowMenu, type MenuItem } from '../patients/CalmList'
import { somText } from '../lib/time'
import type { LabOrder } from './api'
import { STATUS, dueText, fittingText, waiting } from './text'

/** Что можно сделать с заказом из строки — общие для раздела и карточки пациента. */
export type LabActions = {
  onEdit?: (o: LabOrder) => void
  onStatus?: (o: LabOrder, status: LabOrder['status']) => void
  onRework?: (o: LabOrder) => void
  onPay?: (o: LabOrder) => void
  onUnpay?: (o: LabOrder) => void
  onOpenPatient?: (patientId: number) => void
  onDelete?: (o: LabOrder) => void
}

/**
 * Строка заказа (спокойный список): крупно — работа и пациент, под ним серым — лаборатория, врач, примерка;
 * справа — срок (просрочено — красным) или статус; одно действие по статусу («Пришла» / «Установлено»), остальное — «⋯».
 */
export function LabRow({ order: o, showPatient = true, showDoctor = true, busy, actions }: {
  order: LabOrder
  showPatient?: boolean
  showDoctor?: boolean
  busy?: boolean
  actions: LabActions
}) {
  const sub = [
    `«${o.labName}»`,
    showDoctor ? o.doctorName : null,
    o.fittingAt && o.fittingStatus !== 'CANCELLED' && o.status !== 'FITTED' ? `примерка ${fittingText(o.fittingAt)}` : null,
    o.status === 'REWORK' && o.reworkReason ? `переделка: ${o.reworkReason}` : null,
    o.priceSom != null ? `${somText(o.priceSom)}${o.paid ? ' · оплачено' : ''}` : null,
  ].filter(Boolean).join(' · ')
  const items: MenuItem[] = []
  const { onEdit, onStatus, onRework, onPay, onUnpay, onOpenPatient, onDelete } = actions
  if (onStatus && o.status === 'READY') items.push({ label: 'Ещё не пришла', onSelect: () => onStatus(o, 'SENT') })
  if (onStatus && o.status === 'FITTED') items.push({ label: 'Не установлена — вернуть в «Готово»', onSelect: () => onStatus(o, 'READY') })
  if (onRework && !waiting(o)) items.push({ label: 'Переделка…', onSelect: () => onRework(o) })
  if (onEdit) items.push({ label: 'Изменить', onSelect: () => onEdit(o) })
  if (onPay && o.canMoney && !o.paid && (o.priceSom ?? 0) > 0) items.push({ label: 'Оплатить технику…', onSelect: () => onPay(o) })
  if (onUnpay && o.canMoney && o.paid) items.push({ label: 'Отменить оплату', onSelect: () => onUnpay(o) })
  if (onOpenPatient && showPatient) items.push({ label: 'Открыть пациента', onSelect: () => onOpenPatient(o.patientId) })
  if (onDelete && o.canDelete) items.push({ label: 'Удалить', tone: 'bad', onSelect: () => onDelete(o) })
  const action = onStatus && waiting(o)
    ? <button type="button" className="btn small" disabled={busy} onClick={() => onStatus(o, 'READY')} aria-label={`Пришла: ${o.work}`}>Пришла</button>
    : onStatus && o.status === 'READY'
      ? <button type="button" className="btn small" disabled={busy} onClick={() => onStatus(o, 'FITTED')} aria-label={`Установлено: ${o.work}`}>Установлено</button>
      : undefined
  return (
    <CalmRow
      open={onEdit ? () => onEdit(o) : null}
      name={<>{o.work}{showPatient && <span className="lab-row-patient"> — {o.patientName}</span>}</>}
      sub={sub}
      meta={waiting(o)
        ? <span className={o.overdue ? 'lab-due overdue' : 'lab-due'}>{dueText(o)}</span>
        : <span className={`lab-status s-${o.status.toLowerCase()}`}>{STATUS[o.status]}</span>}
      action={action}
      menu={items.length ? <RowMenu label={`Ещё: ${o.work}`} items={items} /> : undefined}
    />
  )
}
