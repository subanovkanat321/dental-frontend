import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { isAssistant, seesAllMoney } from './roles'
import { shortDate, somText, todayIn } from './time'

type Me = Schemas['BookingViewsMe']

/** Строка долга: срок «доплатит до», просрочен — красным. */
export function debtLine(a: { debtSom?: number; dueOn?: string }, today = todayIn()): { text: string; tone: 'wait' | 'bad' } | null {
  if (!a.debtSom || a.debtSom <= 0) return null
  const sum = `Долг ${somText(a.debtSom)}`
  if (!a.dueOn) return { text: sum, tone: 'wait' }
  const due = shortDate(`${a.dueOn}T12:00:00Z`)
  if (a.dueOn < today) return { text: `${sum} · просрочен с ${due}`, tone: 'bad' }
  if (a.dueOn === today) return { text: `${sum} · доплатит сегодня`, tone: 'wait' }
  return { text: `${sum} · доплатит до ${due}`, tone: 'wait' }
}

/**
 * Кто видит долги пациентов («Должники», GET /api/appointments/debts): руководитель, который видит всех, и
 * врач (за свои приёмы). Регистратуре и ассистенту сервер отвечает 403 — им ни меток, ни «Напомнить».
 */
export function seesDebts(me: Me | undefined): boolean {
  if (!me) return false
  return seesAllMoney(me) || (me.doctorId != null && !isAssistant(me))
}

/** «напомнили 15.11» — у строки должника и в карточке пациента. */
export function remindedText(remindedAt: string | undefined): string | null {
  return remindedAt ? `напомнили ${dayMonth(remindedAt)}` : null
}

/** '2026-11-15T04:00:00Z' или '2026-11-25' → «15.11» (по Бишкеку) — коротко, для строки должника. */
export function dayMonth(value: string): string {
  const instant = value.length === 10 ? `${value}T12:00:00Z` : value
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: '2-digit', month: '2-digit' }).format(new Date(instant))
}

/**
 * Долги клиники по пациентам — метка «Долг 5 000» в расписании и карточке приёма. Один запрос на экран (тот же
 * список, что «Должники», сервер сам режет по правам: врачу — его приёмы); нет прав — запроса нет.
 */
export function useDebtsByPatient(): Map<number, number> {
  const me = useMe()
  const debts = useQuery({
    queryKey: ['debts', 'all'],
    queryFn: () => unwrap(api.GET('/api/appointments/debts')),
    enabled: seesDebts(me.data),
    staleTime: 60_000,
    retry: false,
  })
  const map = new Map<number, number>()
  for (const d of debts.data ?? []) if (d.debtSom > 0) map.set(d.patientId, (map.get(d.patientId) ?? 0) + d.debtSom)
  return map
}

/** Долги одного пациента — тот же ключ, что у карточки пациента (['debts', 'patient', id]). */
export function usePatientDebts(patientId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId: patientId! } } })),
    enabled: enabled && patientId != null,
    retry: false,
  })
}

/** Стандартный текст — DebtReminders.STANDARD_RU бэкенда. Совпадает с ним — сохраняем пусто (стандартный). */
export const STANDARD_DEBT = [
  'Здравствуйте, {имя}!',
  'Напоминаем об оплате за лечение в стоматологии «{клиника}».',
  'Врач: {врач}',
  'К оплате: {сумма}.',
  '{оплата}',
  'Если вы уже оплатили — спасибо, просто не обращайте внимания 🙏',
].join('\n')

/**
 * «Оплатить можно в клинике.» и реквизиты — как DebtReminders.howToPay бэкенда: строки — через запятую, запятая или
 * двоеточие в конце убираются, точка не удваивается.
 */
export function howToPay(details: string | null | undefined): string {
  const clean = details?.trim().replace(/\s*\n\s*/g, ', ').replace(/[\s,;:]+$/, '')
  if (!clean) return 'Оплатить можно в клинике.'
  return `Оплатить можно в клинике или переводом: ${clean}${/[.!?)…]$/.test(clean) ? '' : '.'}`
}
