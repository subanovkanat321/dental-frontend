import type { Schemas } from '../api/client'

export type Wish = Schemas['WaitlistWish']

/** Время дня в листе ожидания: «утро / день / вечер» — те же часы «с … до …» на сервере (по Бишкеку). */
export const DAY_PARTS = [
  { key: 'morning', label: 'Утро', from: '08:00', to: '12:00' },
  { key: 'day', label: 'День', from: '12:00', to: '17:00' },
  { key: 'evening', label: 'Вечер', from: '17:00', to: '21:00' },
] as const

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

/** «09:00:00» с сервера → «09:00». */
export function hhmm(time?: string | null): string | null {
  return time ? time.slice(0, 5) : null
}

/** Какая часть дня выбрана: одна из готовых, свои часы ('custom') или любое время (''). */
export function dayPartOf(wish?: Wish | null): string {
  const from = hhmm(wish?.timeFrom)
  const to = hhmm(wish?.timeTo)
  if (!from && !to) return ''
  return DAY_PARTS.find((p) => p.from === from && p.to === to)?.key ?? 'custom'
}

/** 2026-11-27 → «27 нояб». Дата — без времени: читаем и пишем в UTC, зона компьютера ни при чём. */
function day(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).replace('.', '')
}

/** Подпись «Когда удобно» в списке и в карточке: «утро · пн, пт · с 25 нояб по 5 дек»; пусто — «когда угодно». */
export function wishText(wish?: Wish | null): string {
  if (!wish) return 'когда угодно'
  const parts: string[] = []
  const part = DAY_PARTS.find((p) => p.key === dayPartOf(wish))
  const from = hhmm(wish.timeFrom)
  const to = hhmm(wish.timeTo)
  if (part) parts.push(part.label.toLowerCase())
  else if (from || to) parts.push(`${from ? `с ${from}` : ''}${from && to ? ' ' : ''}${to ? `до ${to}` : ''}`)
  const days = wish.weekdays ?? []
  if (days.length && days.length < 7) parts.push(days.map((d) => WEEKDAYS[d - 1]!.toLowerCase()).join(', '))
  if (wish.desiredFrom || wish.desiredTo) {
    parts.push(`${wish.desiredFrom ? `с ${day(wish.desiredFrom)}` : ''}${wish.desiredFrom && wish.desiredTo ? ' ' : ''}${wish.desiredTo ? `по ${day(wish.desiredTo)}` : ''}`)
  }
  return parts.length ? parts.join(' · ') : 'когда угодно'
}
