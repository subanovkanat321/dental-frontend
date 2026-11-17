import { addDays, dateOf, shortDate, timeOf, todayIn } from '../lib/time'
import type { Task } from './api'

export type Group = 'overdue' | 'today' | 'later' | 'none'

export const GROUP_TITLES: Record<Group, string> = { overdue: 'Просрочено', today: 'Сегодня', later: 'Позже', none: 'Без срока' }

/** Группа открытой задачи по сроку — по Бишкеку. */
export function groupOf(task: Task, now = new Date()): Group {
  if (!task.dueAt) return 'none'
  if (new Date(task.dueAt).getTime() < now.getTime()) return 'overdue'
  return dateOf(task.dueAt) === todayIn(now) ? 'today' : 'later'
}

/** Открытые задачи группами в порядке экрана; пустые группы — не показываем. Внутри — по сроку (так отдаёт сервер). */
export function groupTasks(tasks: readonly Task[], now = new Date()): [Group, Task[]][] {
  const by: Record<Group, Task[]> = { overdue: [], today: [], later: [], none: [] }
  for (const t of tasks) by[groupOf(t, now)].push(t)
  return (['overdue', 'today', 'later', 'none'] as const).filter((g) => by[g].length > 0).map((g) => [g, by[g]])
}

/** Срок коротко: сегодня — «18:00», вчера и завтра — словом, иначе «21 нояб, 10:00». */
export function dueText(dueAt: string, now = new Date()): string {
  const today = todayIn(now)
  const day = dateOf(dueAt)
  if (day === today) return timeOf(dueAt)
  if (day === addDays(today, -1)) return `вчера, ${timeOf(dueAt)}`
  if (day === addDays(today, 1)) return `завтра, ${timeOf(dueAt)}`
  return shortDate(dueAt, true)
}

/** Быстрые сроки «＋ Задачи»: дата по Бишкеку и время. «Сегодня 18:00» — пока 18:00 не прошло. */
export function quickDues(now = new Date()): { label: string; date: string; time: string }[] {
  const today = todayIn(now)
  const list = [
    { label: 'Завтра 10:00', date: addDays(today, 1), time: '10:00' },
    { label: 'Через неделю', date: addDays(today, 7), time: '10:00' },
  ]
  return timeOf(now.toISOString()) < '18:00' ? [{ label: 'Сегодня 18:00', date: today, time: '18:00' }, ...list] : list
}
