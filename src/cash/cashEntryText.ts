import type { Schemas } from '../api/client'
import { dateOf, timeOf, todayIn } from '../lib/time'

type Entry = Schemas['PaymentQueryCashEntry']

/** '2026-11-16' → «16.11». */
function dayMonth(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}.${m}`
}

/**
 * За что деньги: «приём сегодня 10:00» / «приём 16.11 10:00», «долг за приём 16.11», «предоплата за 20.11»,
 * «старый долг (из Excel)», «аванс пациента» (V243: деньги вперёд, без приёма). Сервер решает, что это (purpose), — фронт только пишет словами.
 */
export function purposeText(e: Entry, today = todayIn()): string {
  if (e.purpose === 'ADVANCE') return 'аванс пациента'
  if (e.purpose === 'OPENING_DEBT' || !e.appointmentStartAt) return 'старый долг (из Excel)'
  const day = dateOf(e.appointmentStartAt)
  if (e.purpose === 'DEBT') return `долг за приём ${dayMonth(day)}`
  if (e.purpose === 'DEPOSIT') return `предоплата за ${dayMonth(day)}`
  return `приём ${day === today ? 'сегодня' : dayMonth(day)} ${timeOf(e.appointmentStartAt)}`
}
