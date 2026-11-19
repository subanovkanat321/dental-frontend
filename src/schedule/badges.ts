import type { Schemas } from '../api/client'
import { somText } from '../lib/time'
import type { MedAlert } from '../lib/medAlerts'
import { colleagueMarkText } from './chairTime'

type Appointment = Schemas['AppointmentView']

/**
 * Значки на записи — то, что важно увидеть, не открывая карточку. По важности:
 * ❗ важно для врача (аллергия, давление… — «в плашке» анкеты; расшифровка — только тем, кто видит медкарту),
 * 🧾 долг по приёму (кто видит деньги этого врача) или долг пациента за прошлые визиты (кто видит «Должников»),
 * ⭐ ВИП — особое внимание (отметка в карточке пациента), 🆕 первый визит в клинике,
 * 🪑 кресло не врача или часы коллеги по креслу, 💬 есть комментарий.
 * Показываем не больше трёх самых важных, а на узкой записи (15–30 минут в сетке) — один: остальное в подсказке при
 * наведении и в карточке. Подтверждение («Подтвердил 👍») уже в статусе — здесь не дублируем.
 *
 * Подпись у значка — по ширине блока приёма (container query `.appt` в crm.css): в широком блоке
 * чип «⭐ ВИП», в среднем — «⭐ ВИП» коротко, в узком (неделя, телефон) — голый значок. Подпись
 * рисует CSS из data-атрибутов: текст в DOM и имя для скринридера (aria-label) не меняются.
 */
export type Badge = { icon: string; text: string; short?: string; long: string }
type ChairTime = Schemas['SlotsViewChairTime']

/** Сколько значков у записи: больше — шум (владелец: «не шумно»). */
export const MAX_BADGES = 3

export function badgesOf(a: Appointment, money: boolean, chair: ChairTime | undefined, otherChair: string | null, patientDebt = 0,
  alert: MedAlert = null): Badge[] {
  const list: Badge[] = []
  // ❗ Важно для врача: текст ответа анкеты — только с доступом к медкарте (сервер прислал text), иначе — общий
  if (alert) list.push({ icon: '❗', text: alert.text ? `Важно для врача: ${alert.text}` : 'Важно для врача — есть отметки в анкете (аллергия, болезни)', short: 'Важно', long: 'Важно' })
  if (money && a.debtSom > 0) list.push({ icon: '🧾', text: `Долг ${somText(a.debtSom)}`, long: `Долг ${somText(a.debtSom)}` })
  // Записан или ждём — а за прошлые визиты должен: напомнить, когда придёт
  else if (money && patientDebt > 0 && (a.status === 'SCHEDULED' || a.status === 'REQUESTED')) {
    list.push({ icon: '🧾', text: `Долг пациента ${somText(patientDebt)} — напомнить при оплате`, short: somText(patientDebt), long: `Долг ${somText(patientDebt)}` })
  }
  if (a.patient?.vip) list.push({ icon: '⭐', text: 'ВИП — особое внимание', short: 'ВИП', long: 'ВИП' })
  if (a.firstVisit && a.status !== 'CANCELLED') list.push({ icon: '🆕', text: 'Первый визит в клинике', short: 'Новый', long: 'Первый визит' })
  // Кресло выбрано не кресло врача (V210): «🪑 Кресло 2» — где искать пациента
  if (otherChair) list.push({ icon: '🪑', text: `В кресле «${otherChair}» (не кресло врача)`, short: otherChair, long: otherChair })
  // Приём в рабочих часах коллеги по креслу (V187; colleagueTimeOf)
  if (chair) {
    const name = chair.doctorName ?? 'коллеги'
    list.push({ icon: '🪑', text: colleagueMarkText(chair), short: firstName(name), long: `время ${name}` })
  }
  if (a.comment?.trim()) list.push({ icon: '💬', text: `Комментарий: ${a.comment.trim()}`, long: 'Комментарий' })
  return list
}

/** Запись в сетке на 15–30 минут — узкая: один значок, иначе он налезает на имя. */
export function narrowAppt(a: Appointment): boolean {
  if (!a.startAt || !a.endAt) return false
  return Date.parse(a.endAt) - Date.parse(a.startAt) <= 30 * 60_000
}

/** «Айгерим С.» → «Айгерим»: среднему блоку — коротко. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

