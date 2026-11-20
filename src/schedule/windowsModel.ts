import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { dateOf, timeOf, todayIn } from '../lib/time'

export type FreeWindow = Schemas['WaitlistWindowsFreeWindow']

export const WINDOWS_KEY = ['waitlist-windows']

/**
 * «Освободилось окно»: свободные окна сегодня и завтра, в которые подходят пациенты из листа ожидания. Подбирает
 * сервер (часы, дни недели, даты пациента — по Бишкеку); здесь только показываем. Раз в минуту — как расписание.
 */
export function useFreeWindows(enabled = true) {
  return useQuery({
    queryKey: WINDOWS_KEY,
    queryFn: () => unwrap(api.GET('/api/waitlist/windows')),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** Сколько пациентов ещё можно позвать: кто не отказался. */
export function waitingCount(w: FreeWindow): number {
  return w.matches.filter((m) => !m.declined).length
}

function patientsWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'пациент'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'пациента'
  return 'пациентов'
}

/** «подходит 1 пациент» / «подходят 2 пациента». */
export function fitsText(n: number): string {
  return `${n === 1 || (n % 10 === 1 && n % 100 !== 11) ? 'подходит' : 'подходят'} ${n} ${patientsWord(n)} из листа ожидания`
}

/** «Освободилось 15:00–16:00» / «Свободно завтра 09:00–12:00». */
export function windowTitle(w: FreeWindow, today = todayIn()): string {
  const when = dateOf(w.start) === today ? '' : ' завтра'
  return `${w.freed ? 'Освободилось' : 'Свободно'}${when} ${timeOf(w.start)}–${timeOf(w.end)}`
}

