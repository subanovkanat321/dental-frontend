import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'
import { addDays, dateOf, shortDate, timeOf, todayIn } from '../lib/time'

export type Lead = Schemas['LeadView']
export type NewLead = Schemas['NewLead']
export type LeadStatus = Lead['status']
export type LeadChannel = Lead['channel']

/** Все запросы обращений — под одним ключом: изменили — обновились список, число у подраздела и отчёт. */
export const LEADS = ['leads'] as const

/** «Откуда» — по порядку, как в форме (звонок — по умолчанию: чаще всего). */
export const CHANNELS: [LeadChannel, string][] = [
  ['CALL', 'Звонок'], ['WHATSAPP', 'WhatsApp'], ['INSTAGRAM', 'Instagram'], ['TELEGRAM', 'Telegram'], ['SITE', 'Сайт'],
  ['WALK_IN', 'Пришёл сам'], ['RECOMMENDATION', 'По рекомендации'], ['OTHER', 'Другое'],
]

export const CHANNEL_TITLE = Object.fromEntries(CHANNELS) as Record<LeadChannel, string>

export const STATUS_TITLE: Record<LeadStatus, string> = {
  NEW: 'Новое', NO_ANSWER: 'Не дозвонились', THINKING: 'Думает', BOOKED: 'Записан', REFUSED: 'Отказался',
}

export function useLeads(enabled = true) {
  return useQuery({ queryKey: [...LEADS, 'list'], queryFn: () => unwrap(api.GET('/api/leads')), enabled })
}

/** Число у «Обращений»: новые без «перезвонить» и «перезвонить» сегодня или раньше. Раз в минуту — время идёт само. */
export function useLeadSummary(enabled = true) {
  return useQuery({
    queryKey: [...LEADS, 'summary'],
    queryFn: () => unwrap(api.GET('/api/leads/summary')),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useSaveLead() {
  const client = useQueryClient()
  return useMutation<Lead, ApiError, { id?: number; body: NewLead }>({
    mutationFn: ({ id, body }) => unwrap(id == null
      ? api.POST('/api/leads', { body })
      : api.PUT('/api/leads/{id}', { params: { path: { id } }, body })),
    onSettled: () => client.invalidateQueries({ queryKey: LEADS }),
  })
}

export function useLeadStatus() {
  const client = useQueryClient()
  return useMutation<Lead, ApiError, { id: number; status: LeadStatus; callbackAt?: string; reason?: string }>({
    mutationFn: ({ id, ...body }) => unwrap(api.POST('/api/leads/{id}/status', { params: { path: { id } }, body })),
    onSettled: () => client.invalidateQueries({ queryKey: LEADS }),
  })
}

export function useDeleteLead() {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/leads/{id}', { params: { path: { id } } })),
    onSettled: () => client.invalidateQueries({ queryKey: LEADS }),
  })
}

export type Group = 'due' | 'NEW' | 'NO_ANSWER' | 'THINKING' | 'BOOKED' | 'REFUSED'

export const GROUP_TITLES: Record<Group, string> = {
  due: 'Перезвонить сегодня', NEW: 'Новые', NO_ANSWER: 'Не дозвонились', THINKING: 'Думают', BOOKED: 'Записаны', REFUSED: 'Отказались',
}

/**
 * Группы экрана: сначала «Перезвонить сегодня» (с просроченными — они первыми), потом новые, не дозвонились, думают;
 * закрытые — отдельно (свёрнуто внизу). Внутри открытых — по «перезвонить» (так отдаёт сервер), закрытые — свежие сверху.
 */
export function groupLeads(leads: readonly Lead[]): { open: [Group, Lead[]][]; closed: [Group, Lead[]][] } {
  const by: Record<Group, Lead[]> = { due: [], NEW: [], NO_ANSWER: [], THINKING: [], BOOKED: [], REFUSED: [] }
  for (const l of leads) by[l.due ? 'due' : l.status].push(l)
  const time = (l: Lead) => l.closedAt ?? l.updatedAt
  by.BOOKED.sort((a, b) => time(b).localeCompare(time(a)))
  by.REFUSED.sort((a, b) => time(b).localeCompare(time(a)))
  const pick = (groups: Group[]) => groups.filter((g) => by[g].length > 0).map((g): [Group, Lead[]] => [g, by[g]])
  return { open: pick(['due', 'NEW', 'NO_ANSWER', 'THINKING']), closed: pick(['BOOKED', 'REFUSED']) }
}

/** «Перезвонить» коротко: сегодня — «в 18:00», вчера и завтра — словом, иначе «21 нояб, 10:00». */
export function callbackText(at: string, now = new Date()): string {
  const today = todayIn(now)
  const day = dateOf(at)
  if (day === today) return `в ${timeOf(at)}`
  if (day === addDays(today, -1)) return `вчера, ${timeOf(at)}`
  if (day === addDays(today, 1)) return `завтра, ${timeOf(at)}`
  return shortDate(at, true)
}

/**
 * Быстрые «перезвонить» (по Бишкеку): через 2 часа (пока это ещё рабочий день), сегодня в 18:00, завтра в 10:00,
 * через 3 дня. Время в API — UTC: собирает slotInstant у вызывающего.
 */
export function quickCallbacks(now = new Date()): { label: string; date: string; time: string }[] {
  const today = todayIn(now)
  const nowTime = timeOf(now.toISOString())
  const list: { label: string; date: string; time: string }[] = []
  const [h, m] = nowTime.split(':').map(Number) as [number, number]
  if (h + 2 < 20) {
    const t = `${String(h + 2).padStart(2, '0')}:${String(m - (m % 5)).padStart(2, '0')}`
    list.push({ label: 'Через 2 часа', date: today, time: t })
  }
  if (nowTime < '17:00') list.push({ label: 'Сегодня 18:00', date: today, time: '18:00' })
  list.push({ label: 'Завтра 10:00', date: addDays(today, 1), time: '10:00' })
  list.push({ label: 'Через 3 дня', date: addDays(today, 3), time: '10:00' })
  return list
}
