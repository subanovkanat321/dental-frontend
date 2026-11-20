import type { Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']
type Appointment = Schemas['AppointmentView']

/** Вид блока оплаты (PaymentBox): сводка, формы, «К оплате на кассе», «Оплата не отмечена». */
export type PayView = 'show' | 'edit' | 'bill' | 'extra' | 'rest' | 'billed' | 'unpaid'

/** Виды блока, где открыта форма (её кнопка «Принять оплату» — уже «Сохранить»). */
export const PAY_FORMS: PayView[] = ['edit', 'bill', 'extra', 'rest']

/** С чего блок откроется: регистратура со счётом с кассы — сразу форма оплаты; не оплачено — строка с кнопкой. */
export function initialPayView(a: Appointment, me: Me): PayView {
  return a.paidSom != null ? 'show' : a.chargeSom != null && !me.reception ? 'billed' : a.chargeSom != null ? 'edit' : 'unpaid'
}
