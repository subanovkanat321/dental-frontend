import type { Schemas } from '../api/client'
import { formatPhone } from '../lib/phone'

/** Подписи раздела «Команда» — как в приложении (static/js бэкенда), чтобы клиника видела одно и то же. */

export const ROLE_TEXT: Record<string, string> = { ADMIN: 'Администратор', RECEPTION: 'Регистратор', ASSISTANT: 'Ассистент' }

export type Weekday = NonNullable<Schemas['TimeOffView']['weekday']>

export const WEEK: [Weekday, string, string][] = [
  ['MONDAY', 'Понедельник', 'Пн'], ['TUESDAY', 'Вторник', 'Вт'], ['WEDNESDAY', 'Среда', 'Ср'], ['THURSDAY', 'Четверг', 'Чт'],
  ['FRIDAY', 'Пятница', 'Пт'], ['SATURDAY', 'Суббота', 'Сб'], ['SUNDAY', 'Воскресенье', 'Вс'],
]

/** Текст приглашения в боте: ссылка работает один раз и 24 часа. */
export function inviteText(name: string): string {
  return `${name}, приглашаю вас в приложение записи пациентов 🦷 Откройте ссылку и нажмите «Начать»:`
}

/**
 * Сотрудник без Telegram (вход по SMS) — вместо Telegram id у него «синтетический»: отрицательное
 * число не больше −10^15 (бэкенд, shared.PhoneIds). Так же считает сервер.
 */
export function isPhoneLogin(id?: number | null): boolean {
  return id != null && id <= -1e15
}

/** «+996700000011» → «+996 700 000 011» — номер виден только админу клиники. */
export function phoneText(e164?: string | null): string {
  return e164 ? formatPhone(e164.replace(/^\+/, '')) : ''
}
