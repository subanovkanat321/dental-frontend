import type { Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']

/** Ассистент врача (V68): закреплён за врачами, денег и настроек не видит. */
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

/** Менять услуги и цены (и справочник): админ и врачи; регистратура и ассистент только смотрят. */
export function canEditServices(me: Me): boolean {
  return Boolean(me.admin || me.doctorId != null)
}

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
