import type { Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']

/** Ассистент врача (V68): закреплён за врачами, денег и настроек не видит. */
/**
 * Врач по умолчанию в фильтрах «Все врачи / врач» (2026-11-25, владелец: «по дефолту — по врачу авторизованному»):
 * свой врач, если он среди врачей фильтра; ассистенту одного врача — этот врач; иначе null — «Все врачи».
 * ids — врачи в выборе фильтра (нет — все активные врачи клиники).
 */
export function myDoctorDefault(me: Me, ids?: (number | undefined)[]): number | null {
  const list = ids ?? (me.doctors ?? []).filter((d) => d.active !== false).map((d) => d.id)
  if (me.doctorId != null && list.includes(me.doctorId)) return me.doctorId
  if (me.assistantOf?.length === 1 && list.includes(me.assistantOf[0])) return me.assistantOf[0]!
  return null
}

export function isAssistant(me: Me): boolean {
  return (me.assistantOf?.length ?? 0) > 0
}

/**
 * Менять расписание врача: админ, регистратура, сам врач и его ассистент. Тот же список, что на
 * сервере (Staff.requireCanEdit): здесь — только чтобы не показывать кнопки, которые сервер отклонит.
 */
export function canEditDoctor(me: Me, doctorId: number | null | undefined): boolean {
  if (doctorId == null) return false
  return Boolean(me.admin || me.reception || doctorId === me.doctorId || me.assistantOf?.includes(doctorId))
}

/** Врачи, к которым этот сотрудник может записать или передать приём (сервер — Staff.requireCanEdit). */
export function editableDoctors<D extends { id?: number }>(me: Me, doctors: D[]): D[] {
  return doctors.filter((d) => canEditDoctor(me, d.id))
}

/**
 * «Мои закупки» (Склад): врач со своим приёмом (не ассистент) в клинике, где врачи работают
 * независимо и у каждого свой склад, — поставки на его склад. Руководитель, который видит деньги всех,
 * вместо этого видит «Расходы на склад». Как SupplyController.ownStock на сервере.
 */
export function seesOwnPurchases(me: Me): boolean {
  return !seesAllMoney(me) && !isAssistant(me) && me.doctorId != null
    && Boolean(me.clinic?.independentDoctors && me.clinic?.separateSupplies)
}

/**
 * Деньги всех врачей. Админ — если клиника не в режиме «Врачи работают независимо»; владелец — всегда:
 * владелец платформы и админ без своего приёма (хозяин кабинета). Как Staff.seesAllDoctors на сервере.
 */
export function seesAllMoney(me: Me): boolean {
  if (me.platform) return true
  return Boolean(me.admin && (!me.clinic?.independentDoctors || me.doctorId == null))
}

/**
 * Деньги приёма этого врача (оплата, счёт, долг, предоплата): регистратура, админ «видит всех» и сам
 * врач. Коллеге и «независимому» админу сервер отдаёт приём без сумм — денежных строк и кнопок нет.
 */
export function seesMoneyOf(me: Me, doctorId: number | null | undefined): boolean {
  if (isAssistant(me)) return false
  return Boolean(me.reception) || seesAllMoney(me) || (doctorId != null && doctorId === me.doctorId)
}

/** «Ждут оплаты на кассе» (/to-pay): только в клинике с регистратурой и тем, кому сервер его отдаст. */
export function seesToPay(me: Me): boolean {
  return Boolean(me.reception || me.hasReception) && (Boolean(me.reception) || seesAllMoney(me) || me.doctorId != null)
}

/**
 * Открыть карточку услуги и вести то, что у неё «своё» у врача: материалы и памятку — админ и врачи;
 * регистратура и ассистент только смотрят. Сам прайс (название, цену, «В прайсе») — {@link canEditPrices}.
 */
export function canEditServices(me: Me): boolean {
  return Boolean(me.admin || me.doctorId != null)
}

/**
 * Общие цены и часы клиники (прайс, «Часы клиники», «О клинике») — только руководитель (с 2026-11-13;
 * раньше и любой врач). Врач меняет свои часы и свой список услуг — в своей карточке. Как сервер.
 */
export function canEditPrices(me: Me): boolean {
  return Boolean(me.admin)
}

/** Подпись врачу у прайса и часов клиники — тот же текст, что сервер отвечает 403. */
export const PRICES_BY_HEAD = 'Цены и часы клиники меняет руководитель'

/**
 * «Мой заработок»: врач со своим креслом (в том числе админ, который сам ведёт приём). Админ без
 * кресла, регистратура и ассистент его не видят — сервер им отвечает 403 (EarningsController).
 */
export function seesOwnEarnings(me: Me): boolean {
  return me.doctorId != null && !isAssistant(me)
}

/**
 * Общие расходы клиники с ключом деления (аренда кабинета, коммуналка): записывать и видеть доли всех
 * врачей. Тот, кто видит деньги всех, а при «врачи работают независимо» — любой врач и админ (сервер —
 * ExpenseController.mayShared). Регистратура и ассистент — нет.
 */
export function canShareExpenses(me: Me): boolean {
  if (seesAllMoney(me)) return true
  return Boolean(me.clinic?.independentDoctors) && !isAssistant(me) && Boolean(me.admin || me.doctorId != null)
}

/**
 * Чьи оценки пациентов видит сотрудник («Пациенты → Оценки»): null — всей клиники (руководитель, который видит всех
 * врачей, и регистратура); иначе — эти врачи (ассистент — свои врачи, врач — свои приёмы). Пусто — вкладки нет.
 * Как AppointmentController.ratingDoctors на сервере (проверяет он; здесь — только что показать).
 */
export function ratingDoctors(me: Me): number[] | null {
  if (seesAllMoney(me) || me.reception) return null
  const ids = [...(me.assistantOf ?? [])]
  if (me.doctorId != null && !ids.includes(me.doctorId)) ids.push(me.doctorId)
  return ids
}

/** Вкладка «Пациенты → Оценки»: кто видит хоть чьи-то оценки. */
export function seesRatings(me: Me): boolean {
  const ids = ratingDoctors(me)
  return ids == null || ids.length > 0
}

/**
 * Аванс пациента (V243): остаток видят руководитель, регистратура и врачи (оплатить приём «С аванса»); ассистент — нет.
 * Принимают аванс регистратура и руководитель, возвращает — только руководитель. Как AdvanceController на сервере.
 */
export function seesAdvance(me: Me): boolean {
  return !isAssistant(me) && Boolean(me.admin || me.reception || me.doctorId != null)
}

export function takesAdvance(me: Me): boolean {
  return Boolean(me.admin || me.reception)
}

export function refundsAdvance(me: Me): boolean {
  return Boolean(me.admin)
}
