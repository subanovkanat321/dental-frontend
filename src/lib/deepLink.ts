import { addDays, todayIn } from './time'
import type { Page } from './route'

/**
 * Куда открыть CRM по кнопке бота. Бот шлёт адреса Mini App с параметрами (AssetVersion.miniApp
 * бэкенда): ?appointment=ID — карточка приёма, ?day=tomorrow — завтра, ?patient=ID — новая запись
 * на этого пациента, ?patientCard=ID — карточка пациента, ?supply=ID — материал на складе,
 * ?screen=cash|stats|dental-news|support|support-tickets|pay-requests — раздел; ?doctor=ID — «День»
 * этого врача (уведомление о приёмах коллеги), можно вместе с ?day=tomorrow.
 */

/**
 * Адрес запуска, каким он пришёл: App чистит его после разбора, а самозаписи пациента нужен
 * свой ?doctor=… («Записаться снова» к тому же врачу).
 */
export const startSearch = typeof window === 'undefined' ? '' : window.location.search

export type DeepLink = {
  page: Page
  date?: string
  appointmentId?: number
  bookPatientId?: number
  patientId?: number
  supplyId?: number
  tab?: string
  ticketId?: number
  doctorId?: number
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
  if (num('supply')) return { page: 'stock', supplyId: num('supply') }
  if (screen === 'cash') return { page: 'cash', tab: 'money' }
  if (screen === 'stats') return { page: 'cash', tab: 'stats' }
  if (screen === 'dental-news') return { page: 'account', tab: 'news' }
  if (screen === 'support') return { page: 'account', tab: 'support', ticketId: num('ticket') }
  if (screen === 'support-tickets') return { page: 'platform', tab: 'tickets' }
  if (screen === 'pay-requests') return { page: 'platform', tab: 'clinics' }
  const tomorrow = p.get('day') === 'tomorrow' ? addDays(today, 1) : undefined
  if (num('doctor')) return { page: 'schedule', doctorId: num('doctor'), date: tomorrow }
  if (tomorrow) return { page: 'schedule', date: tomorrow }
  return null
}
