import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

export type GroupItem = Schemas['SegmentServiceGroupItem']
export type GroupRef = Schemas['SegmentServiceGroupRef']
export type GroupFilter = Schemas['SegmentFilter']
export type Members = Schemas['SegmentServiceMembers']
export type MessageView = Schemas['SegmentServiceMessageView']
export type Ready = NonNullable<GroupItem['ready']>
export type SkipReason = Schemas['SegmentServiceSkipped']['reason']
export type PlanStatus = NonNullable<GroupFilter['planStatus']>

/** Все запросы групп — под одним ключом: создали задачи или сообщение — обновились числа и история. */
export const GROUPS = ['patient-groups'] as const

/** Что значит готовая группа — серая строка под названием в списке групп. */
export const READY_HINT: Record<Ready, string> = {
  LAPSED_6: 'Последний визит больше полугода назад, не записаны',
  LAPSED_12: 'Последний визит больше года назад, не записаны',
  DROPPED: 'Начали лечение или согласились с планом и пропали',
  PLAN_NOT_AGREED: 'План предложен, ответа нет больше 3 дней',
  ONE_VISIT: 'Был один приём больше месяца назад',
  DEBT: 'Не доплатили за лечение',
  BIRTHDAY_MONTH: 'Поздравить и пригласить на осмотр',
  NO_TELEGRAM: 'Бот им не напишет — WhatsApp или звонок',
}

export const SKIP_TEXT: Record<SkipReason, string> = {
  RECENT: 'уже получал сообщение группы за 7 дней',
  OPTED_OUT: 'попросил не присылать такие сообщения',
  NO_CONTACT: 'нет ни бота, ни телефона',
  HAS_TASK: 'уже есть такая задача',
}

export const PLAN_STATUS_TEXT: Record<PlanStatus, string> = {
  PROPOSED: 'Предложен',
  AGREED: 'Согласован',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершён',
  REFUSED: 'Отказался',
}

/** Подстановки шаблона сообщения — те же, что проверяет сервер (SegmentService.VARIABLES). */
export const VARIABLES: { token: string; label: string }[] = [
  { token: '{имя}', label: 'Имя' },
  { token: '{врач}', label: 'Врач' },
  { token: '{дата_последнего_визита}', label: 'Дата визита' },
  { token: '{клиника}', label: 'Клиника' },
  { token: '{телефон}', label: 'Телефон' },
]

/** Ссылка на группу из строки списка: готовая, метка или своя. */
export function refOf(g: GroupItem): GroupRef {
  if (g.kind === 'READY') return { ready: g.ready }
  if (g.kind === 'TAG') return { tagId: g.tagId }
  return { groupId: g.groupId }
}

/** Ключ строки и запроса — одна группа один ключ. */
export function keyOf(ref: GroupRef): string {
  return ref.ready ?? (ref.tagId != null ? `tag-${ref.tagId}` : `group-${ref.groupId}`)
}

export function useGroups() {
  return useQuery({ queryKey: [...GROUPS, 'list'], queryFn: () => unwrap(api.GET('/api/patient-groups')) })
}

export function useMembers(ref: GroupRef, doctorId: number | null, limit: number) {
  return useQuery({
    queryKey: [...GROUPS, 'members', keyOf(ref), doctorId, limit],
    queryFn: () => unwrap(api.GET('/api/patient-groups/members', {
      params: { query: { ready: ref.ready, tagId: ref.tagId, groupId: ref.groupId, doctorId: doctorId ?? undefined, limit } },
    })),
    placeholderData: (prev) => prev,
  })
}

/** «12 пациентов», «1 пациент», «3 пациента». */
export function patientsText(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod100 >= 11 && mod100 <= 14 ? 'пациентов' : mod10 === 1 ? 'пациент' : mod10 >= 2 && mod10 <= 4 ? 'пациента' : 'пациентов'
  return `${n} ${word}`
}

/** «5 задач», «1 задача», «3 задачи». */
export function tasksText(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  const word = mod100 >= 11 && mod100 <= 14 ? 'задач' : mod10 === 1 ? 'задача' : mod10 >= 2 && mod10 <= 4 ? 'задачи' : 'задач'
  return `${n} ${word}`
}

/** Вставить подстановку в позицию курсора (или в конец, если поле не в фокусе). */
export function insertAt(text: string, token: string, start: number | null, end: number | null): { text: string; caret: number } {
  const from = start ?? text.length
  const to = end ?? from
  const next = text.slice(0, from) + token + text.slice(to)
  return { text: next, caret: from + token.length }
}

/** Условия своей группы коротко — серая строка в списке групп. */
export function filterText(f: GroupFilter | undefined, names: { doctor?: string; tag?: string; service?: string }): string {
  if (!f) return ''
  const parts: string[] = []
  if (f.lastVisitOlderMonths != null) parts.push(`не были ${f.lastVisitOlderMonths}+ мес.`)
  if (f.lastVisitNewerMonths != null) parts.push(`были за ${f.lastVisitNewerMonths} мес.`)
  if (f.doctorId != null) parts.push(names.doctor ?? 'врач')
  if (f.tagId != null) parts.push(names.tag ? `метка «${names.tag}»` : 'метка')
  if (f.serviceTypeId != null) parts.push(names.service ?? 'услуга')
  if (f.planStatus) parts.push(`план: ${PLAN_STATUS_TEXT[f.planStatus].toLowerCase()}`)
  if (f.inBot != null) parts.push(f.inBot ? 'в боте' : 'без бота')
  if (f.ageFrom != null || f.ageTo != null) parts.push(`возраст ${f.ageFrom ?? 0}–${f.ageTo ?? '…'}`)
  if (f.notBooked) parts.push('без записи')
  return parts.join(' · ')
}
