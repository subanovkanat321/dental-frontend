import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { WEEK, type Weekday } from './texts'

type TimeOff = Schemas['TimeOffView']

/**
 * Часы работы и еженедельные выходные — два места («Рабочее время → Врачи» и «Перерывы и выходные»),
 * но один смысл: работает ли врач в этот день недели. Сервер закрывает день, если закрыто хоть
 * одно из двух; здесь — чтобы на экране не было противоречия «в часах пятница рабочая, а в
 * выходных — каждую пятницу выходной» (просьба владельца 2026-11-06).
 */

/** Список «Перерывов и выходных» — тот же запрос и кеш, что у вкладки. */
export function useTimeOff() {
  return useQuery({ queryKey: ['time-off'], queryFn: () => unwrap(api.GET('/api/time-off')) })
}

/** Еженедельный выходной на весь день (не перерыв с временем и не даты). */
const weeklyWholeDay = (t: TimeOff) => Boolean(t.weekday && !t.startTime && !t.firstDay)

/**
 * Какие дни недели закрыты еженедельным выходным: для врача — его и всей клиники (выходной всей
 * клиники важнее: удалив свой, день рабочим не сделать), для клиники (null) — только общие.
 */
export function weeklyDaysOff(list: TimeOff[] | undefined, doctorId: number | null): Partial<Record<Weekday, TimeOff>> {
  const off: Partial<Record<Weekday, TimeOff>> = {}
  for (const t of list ?? []) {
    if (!weeklyWholeDay(t)) continue
    const clinicWide = t.doctorId == null
    if (!clinicWide && t.doctorId !== doctorId) continue
    if (clinicWide || !off[t.weekday!]) off[t.weekday!] = t
  }
  return off
}

// «В пятницу», «Во вторник»; «пятницу», «вторник»; «рабочей»/«рабочим» — род дня недели
const IN: Record<Weekday, string> = {
  MONDAY: 'В понедельник', TUESDAY: 'Во вторник', WEDNESDAY: 'В среду', THURSDAY: 'В четверг',
  FRIDAY: 'В пятницу', SATURDAY: 'В субботу', SUNDAY: 'В воскресенье',
}
const ACCUSATIVE: Record<Weekday, string> = {
  MONDAY: 'понедельник', TUESDAY: 'вторник', WEDNESDAY: 'среду', THURSDAY: 'четверг',
  FRIDAY: 'пятницу', SATURDAY: 'субботу', SUNDAY: 'воскресенье',
}
const FEMININE = new Set<Weekday>(['WEDNESDAY', 'FRIDAY', 'SATURDAY'])

/** «В пятницу», «Во вторник». */
export const onWeekday = (d: Weekday) => IN[d]

/** «⏸️ Выходной» — как в списке выходных. */
export const offLabel = (t: TimeOff) => `${t.emoji ?? ''} ${t.title ?? ''}`.trim()

/**
 * Поставили галочку рабочего дня, а на него выходной. Свой выходной врача (или общий — в часах
 * клиники) — спросить и удалить; выходной всей клиники в часах врача — не трогаем молча: он у
 * всех, объясняем и предлагаем открыть «Перерывы и выходные». true — выходной можно удалить.
 */
export async function askMakeWorkday({ day, off, who, doctorHours, onTimeOff }: {
  day: Weekday; off: TimeOff; who: string; doctorHours: boolean; onTimeOff?: () => void
}): Promise<boolean> {
  if (doctorHours && off.doctorId == null) {
    const text = `${IN[day]} выходной у всей клиники — уберите его в «Перерывы и выходные» (это затронет всех врачей)`
    if (onTimeOff) {
      if (await ask(text, { ok: 'Открыть «Перерывы и выходные»' })) onTimeOff()
    } else await ask(text, { ok: 'Понятно', single: true })
    return false
  }
  const working = FEMININE.has(day) ? 'рабочей' : 'рабочим'
  return ask(`${IN[day]} у ${who} стоит выходной «${offLabel(off)}». Сделать ${ACCUSATIVE[day]} ${working}? Выходной удалится.`,
    { ok: `Сделать ${working}`, danger: true })
}

/** Все дни недели по порядку. */
export const DAYS: Weekday[] = WEEK.map(([code]) => code)
