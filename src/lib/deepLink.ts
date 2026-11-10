import { addDays, todayIn } from './time'
import type { Page } from './route'

/**
 * Куда открыть CRM по кнопке бота. Бот шлёт адреса Mini App с параметрами (AssetVersion.miniApp
 * бэкенда): ?appointment=ID — карточка приёма, ?day=tomorrow — завтра, ?patient=ID — новая запись
 * на этого пациента, ?patientCard=ID — карточка пациента, ?question=ID — вопрос пациента, ?supply=ID — материал на складе,
 * ?screen=cash|stats|earnings|support|support-tickets|pay-requests|survey|shifts|learn|agreement — раздел; ?doctor=ID — «День»
 * этого врача (уведомление о приёмах коллеги), можно вместе с ?day=tomorrow;
 * ?screen=booked&day=today|tomorrow&unconfirmed=1&doctor=ID — «Пациенты → Записаны» на этот день, только
 * кто не подтвердил (кнопка «📲 Напомнить (N)» под утренней и вечерней сводкой).
 */

/**
 * Адрес запуска, каким он пришёл: App чистит его после разбора, а самозаписи пациента нужен
 * свой ?doctor=… («Записаться снова» к тому же врачу).
 */
let launched: string | null = null

/** App запоминает адрес запуска перед тем, как почистить его. */
export function rememberLaunch(search: string): void {
  launched = search
}

export function launchSearch(): string {
  return launched ?? window.location.search
}

export type DeepLink = {
  page: Page
  date?: string
  appointmentId?: number
  bookPatientId?: number
  /** «Записать» из «Позвать снова → Отменили»: врач, услуга и длительность отменённой записи */
  bookDoctorId?: number
  bookServiceId?: number
  bookDuration?: number
  patientId?: number
  questionId?: number
  supplyId?: number
  tab?: string
  ticketId?: number
  doctorId?: number
  /** «Записаны»: только кто не подтвердил */
  unconfirmed?: boolean
}

export function readDeepLink(search: string, today = todayIn()): DeepLink | null {
  const p = new URLSearchParams(search)
  const num = (key: string) => {
    const n = Number(p.get(key))
    return Number.isInteger(n) && n > 0 ? n : undefined
  }
  const screen = p.get('screen')
  if (num('appointment')) return { page: 'schedule', appointmentId: num('appointment') }
  if (num('patient')) return { page: 'schedule', bookPatientId: num('patient') }
  if (num('patientCard')) return { page: 'patients', patientId: num('patientCard') }
  if (num('question')) return { page: 'patients', questionId: num('question') }
  if (num('supply')) return { page: 'stock', supplyId: num('supply') }
  if (screen === 'cash') return { page: 'cash', tab: 'money' }
  if (screen === 'stats') return { page: 'cash', tab: 'stats' }
  if (screen === 'earnings') return { page: 'cash', tab: 'earnings' }
  if (screen === 'support') return { page: 'settings', tab: 'support', ticketId: num('ticket') }
  if (screen === 'survey') return { page: 'settings', tab: 'survey' }
  // Напоминание «подпишите договор» (бот или push админу)
  if (screen === 'agreement') return { page: 'settings', tab: 'agreement' }
  if (screen === 'shifts') return { page: 'settings', tab: 'shifts' }
  // «Для пациента»: 3D-атлас и презентации
  if (screen === 'learn') return { page: 'learn' }
  if (screen === 'booked') {
    const day = p.get('day') === 'tomorrow' ? addDays(today, 1) : p.get('day') === 'today' ? today : undefined
    return { page: 'patients', tab: 'booked', date: day, unconfirmed: p.get('unconfirmed') === '1', doctorId: num('doctor') }
  }
  if (screen === 'support-tickets') return { page: 'platform', tab: 'tickets' }
  if (screen === 'pay-requests') return { page: 'platform', tab: 'clinics' }
  const tomorrow = p.get('day') === 'tomorrow' ? addDays(today, 1) : undefined
  if (num('doctor')) return { page: 'schedule', doctorId: num('doctor'), date: tomorrow }
  if (tomorrow) return { page: 'schedule', date: tomorrow }
  return null
}

/**
 * Адрес (без «#/»), куда ведёт ссылка: раздел и подраздел — #/cash/earnings, #/patients/questions,
 * #/settings/support. Подраздел в адресе — его и откроет раздел (lib/sub), и подсветит меню.
 */
export function linkHash(link: DeepLink): string {
  const sub = link.page === 'patients'
    // Карточка пациента (имя в приёме, кнопка бота) — поверх списка «Все», как раньше
    ? (link.questionId ? 'questions' : link.tab ?? (link.patientId ? 'all' : undefined))
    : link.page === 'stock' ? undefined : link.tab
  return sub ? `${link.page}/${sub}` : link.page
}
