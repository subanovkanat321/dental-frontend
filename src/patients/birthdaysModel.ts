import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

type Row = Schemas['BirthdaysRow']

export const BIRTHDAYS_KEY = ['birthdays']

/** Именинники сегодня (по Бишкеку): действующие пациенты с датой рождения в карточке. Считает сервер. */
export function useBirthdays(enabled = true) {
  return useQuery({
    queryKey: BIRTHDAYS_KEY,
    queryFn: () => unwrap(api.GET('/api/birthdays/today')),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Сколько ещё не поздравили. */
export function notGreeted(rows: Row[] | undefined): number {
  return (rows ?? []).filter((r) => !r.greetedAt).length
}

