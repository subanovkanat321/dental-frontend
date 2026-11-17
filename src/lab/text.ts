import type { Schemas } from '../api/client'
import { isAssistant, seesAllMoney } from '../lib/roles'
import { addDays, dateOf, timeOf, todayIn } from '../lib/time'
import type { LabKind, LabOrder, LabStatus } from './api'

type Me = Schemas['BookingViewsMe']

export const KINDS: [LabKind, string][] = [['CROWN', 'Коронка'], ['BRIDGE', 'Мост'], ['VENEER', 'Винир'], ['INLAY', 'Вкладка'],
  ['DENTURE', 'Протез съёмный'], ['SPLINT', 'Капа'], ['OTHER', 'Другое']]

export const STATUS: Record<LabStatus, string> = { SENT: 'Отправлено', READY: 'Готово', FITTED: 'Установлено', REWORK: 'Переделка' }

/** Ждём от техника: отправлено или на переделке. */
export function waiting(o: Pick<LabOrder, 'status'>): boolean {
  return o.status === 'SENT' || o.status === 'REWORK'
}

/**
 * Видит цену работы, оплату и «Должны лабораториям» — как расходы (сервер — LabOrders.Scope.money): руководитель,
 * который видит всех, и врач (свои заказы). Регистратуре и ассистенту — нет.
 */
export function seesLabMoney(me: Me): boolean {
  return seesAllMoney(me) || (me.doctorId != null && !isAssistant(me))
}

/** Группы раздела: ждём (по сроку), готово — ждёт установки; установленные — отдельно, свёрнуто. */
export function groupOrders(orders: readonly LabOrder[]): { waiting: LabOrder[]; ready: LabOrder[] } {
  return {
    waiting: orders.filter(waiting),
    // Готовые — по ближайшей примерке (без примерки — в конце)
    ready: orders.filter((o) => o.status === 'READY')
      .sort((a, b) => (a.fittingAt ?? '9999').localeCompare(b.fittingAt ?? '9999')),
  }
}

/** «Бакыт Тестов» → «Бакыт Т.» — для письма технику: ему хватит имени и первой буквы. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts[0]} ${parts[1]!.charAt(0)}.`
}

const DAY_MS = 86_400_000

/** Сколько дней просрочено (по Бишкеку). */
export function daysLate(dueOn: string, now = new Date()): number {
  return Math.round((Date.parse(`${todayIn(now)}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / DAY_MS)
}

/** Срок готовности коротко: «сегодня», «завтра», «до 24 нояб»; просрочено — «просрочено 3 дн.». */
export function dueText(o: Pick<LabOrder, 'dueOn' | 'overdue'>, now = new Date()): string {
  const today = todayIn(now)
  if (o.overdue) return `просрочено ${daysLate(o.dueOn, now)} дн.`
  if (o.dueOn === today) return 'готово сегодня'
  if (o.dueOn === addDays(today, 1)) return 'готово завтра'
  return `до ${dayText(o.dueOn)}`
}

/** «24 нояб» по дате ГГГГ-ММ-ДД. */
export function dayText(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' })
    .format(new Date(`${date}T00:00:00Z`)).replace(/\./g, '')
}

/** Примерка коротко: «сегодня 10:00», «завтра 10:00», «24 нояб, 10:00». */
export function fittingText(at: string, now = new Date()): string {
  const day = dateOf(at)
  const today = todayIn(now)
  if (day === today) return `сегодня ${timeOf(at)}`
  if (day === addDays(today, 1)) return `завтра ${timeOf(at)}`
  return `${dayText(day)}, ${timeOf(at)}`
}

/** WhatsApp техника: свой номер WhatsApp или телефон. */
export function technicianPhone(o: Pick<LabOrder, 'labWhatsapp' | 'labPhone'>): string | undefined {
  return o.labWhatsapp ?? o.labPhone ?? undefined
}

/**
 * Письмо технику — собирается в браузере (имя пациента не уходит ни на сервер, ни в адрес CRM):
 * «Здравствуйте! Работа для пациента Бакыт Т., коронка 36 — готова? Примерка завтра в 10:00».
 */
export function technicianText(o: LabOrder, now = new Date()): string {
  const work = o.work.charAt(0).toLowerCase() + o.work.slice(1)
  const fitting = o.fittingAt ? ` Примерка ${fittingText(o.fittingAt, now).replace(/^(\S+) (\d)/, '$1 в $2')}.` : ''
  return `Здравствуйте! Работа для пациента ${shortName(o.patientName)}, ${work} — готова?${fitting}`
}

/** Этап плана лечения — работа техника? «Коронка металлокерамика» → CROWN; не похоже — null (кнопки «🦷» нет). */
export function labKindOf(title: string | undefined): LabKind | null {
  const t = (title ?? '').toLowerCase()
  if (/коронк/.test(t)) return 'CROWN'
  if (/мост/.test(t)) return 'BRIDGE'
  if (/винир/.test(t)) return 'VENEER'
  if (/вкладк|культев/.test(t)) return 'INLAY'
  if (/протез/.test(t)) return 'DENTURE'
  if (/(^|[^а-яё])кап[аыу]?($|[^а-яё])|элайнер|сплинт/.test(t)) return 'SPLINT'
  return null
}
