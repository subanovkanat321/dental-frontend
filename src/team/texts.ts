import type { Schemas } from '../api/client'

/** Подписи раздела «Команда» — как в приложении (static/js бэкенда), чтобы клиника видела одно и то же. */

export const ROLE_TEXT: Record<string, string> = { ADMIN: 'Администратор', RECEPTION: 'Регистратор' }

export type Weekday = NonNullable<Schemas['TimeOffView']['weekday']>

export const WEEK: [Weekday, string, string][] = [
  ['MONDAY', 'Понедельник', 'Пн'], ['TUESDAY', 'Вторник', 'Вт'], ['WEDNESDAY', 'Среда', 'Ср'], ['THURSDAY', 'Четверг', 'Чт'],
  ['FRIDAY', 'Пятница', 'Пт'], ['SATURDAY', 'Суббота', 'Сб'], ['SUNDAY', 'Воскресенье', 'Вс'],
]

// Винительный падеж для «Каждую пятницу», «Каждый вторник», «Каждое воскресенье»
const ON_WEEKDAY: Record<Weekday, string> = {
  MONDAY: 'Каждый понедельник', TUESDAY: 'Каждый вторник', WEDNESDAY: 'Каждую среду', THURSDAY: 'Каждый четверг',
  FRIDAY: 'Каждую пятницу', SATURDAY: 'Каждую субботу', SUNDAY: 'Каждое воскресенье',
}

/** Значки перерывов: пациенты видят их в боте рядом с названием. */
export const TIME_OFF_EMOJI = ['🕌', '🍽️', '☕', '🏖️', '✈️', '🤒', '📚', '👨‍👩‍👧', '⏸️']

/** «Каждую пятницу · 12:00–14:00» или «3 ноя – 10 ноя · весь день». */
export function timeOffWhen(t: Schemas['TimeOffView']): string {
  const hours = t.startTime && t.endTime ? `${t.startTime.slice(0, 5)}–${t.endTime.slice(0, 5)}` : 'весь день'
  if (t.weekday) return `${ON_WEEKDAY[t.weekday]} · ${hours}`
  const fmt = (d?: string) => (d ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short' })
    .format(new Date(`${d}T00:00:00Z`)).replace('.', '') : '')
  const days = t.firstDay === t.lastDay ? fmt(t.firstDay) : `${fmt(t.firstDay)} – ${fmt(t.lastDay)}`
  return `${days} · ${hours}`
}

/** Текст приглашения в боте: ссылка работает один раз и 24 часа. */
export function inviteText(name: string): string {
  return `${name}, приглашаю вас в приложение записи пациентов 🦷 Откройте ссылку и нажмите «Начать»:`
}
