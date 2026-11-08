import type { Schemas } from '../api/client'

export type Question = Schemas['SurveyQuestion']
export type QuestionType = NonNullable<Question['type']>
export type Role = NonNullable<Schemas['SurveyDefinition']['roles']>[number]

/** Роли сотрудников клиники — кому адресован опрос (как Survey.Role на сервере). */
export const ROLES: [Role, string][] = [['ADMIN', 'Руководители'], ['DOCTOR', 'Врачи'], ['RECEPTION', 'Регистратура'], ['ASSISTANT', 'Ассистенты']]

/** Одна роль — в итогах и у ответов текстом. */
export const ROLE_ONE: Record<Role, string> = { ADMIN: 'руководитель', DOCTOR: 'врач', RECEPTION: 'регистратура', ASSISTANT: 'ассистент' }

export function rolesText(roles: Role[] | undefined): string {
  return roles?.length ? roles.map((r) => ROLE_ONE[r]).join(', ') : 'все сотрудники'
}

/** Вид вопроса: подпись в редакторе. */
export const TYPES: [QuestionType, string][] = [
  ['RATING', 'Оценка 1–5 ★'],
  ['NPS', 'Порекомендуете? 0–10'],
  ['SINGLE', 'Один вариант'],
  ['MULTI', 'Несколько вариантов'],
  ['TEXT', 'Свой ответ текстом'],
  ['CONTACT', 'Можно связаться? Да / Нет'],
]

export const hasOptions = (type: QuestionType | undefined) => type === 'SINGLE' || type === 'MULTI'

/** Статус опроса у владельца: подпись и цвет плашки (классы статусов DESIGN.md). */
export const STATUS: Record<NonNullable<Schemas['SurveySummary']['status']>, [string, string]> = {
  DRAFT: ['черновик — не видят', 's-quiet'],
  SCHEDULED: ['запущен, ждёт первого дня', 's-wait'],
  OPEN: ['идёт', 's-ok'],
  FINISHED: ['сроки вышли', 's-done'],
  STOPPED: ['остановлен', 's-done'],
}
