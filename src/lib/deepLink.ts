import { addDays, todayIn } from './time'
import type { Page } from './route'

/**
 * Куда открыть CRM по кнопке бота. Бот шлёт адреса Mini App с параметрами (AssetVersion.miniApp
 * бэкенда): ?appointment=ID — карточка приёма, ?day=tomorrow — завтра, ?patient=ID — новая запись
 * на этого пациента, ?patientCard=ID — карточка пациента, ?supply=ID — материал на складе,
 * ?screen=cash|stats|dental-news|support|support-tickets|pay-requests — раздел.
 */
export type DeepLink = {
  page: Page
  date?: string
  appointmentId?: number
  bookPatientId?: number
  patientId?: number
  supplyId?: number
  tab?: string
  ticketId?: number
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
  if (p.get('day') === 'tomorrow') return { page: 'schedule', date: addDays(today, 1) }
  return null
}
