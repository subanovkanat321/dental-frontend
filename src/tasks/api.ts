import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type ApiError, type Schemas } from '../api/client'

export type Task = Schemas['TaskView']
export type NewTask = Schemas['NewTask']
export type Assignee = Schemas['TaskControllerAssignee']

/** Все запросы задач — под одним ключом: изменили задачу — обновились список, карточка пациента и счётчик. */
export const TASKS = ['tasks'] as const

/** Открытые или выполненные задачи (выполненные — последние 100), «Мои» и задачи пациента — фильтры сервера. */
export function useTasks(params: { status?: 'OPEN' | 'DONE'; mine?: boolean; patientId?: number }, enabled = true) {
  return useQuery({
    queryKey: [...TASKS, 'list', params],
    queryFn: () => unwrap(api.GET('/api/tasks', { params: { query: params } })),
    enabled,
  })
}

/**
 * Мои просроченные задачи — значок «Задачи» в меню и строка в расписании. Раз в минуту: срок наступает
 * без действий в приложении.
 */
export function useTaskSummary(enabled = true) {
  return useQuery({
    queryKey: [...TASKS, 'summary'],
    queryFn: () => unwrap(api.GET('/api/tasks/summary')),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useAssignees(enabled = true) {
  return useQuery({
    queryKey: [...TASKS, 'assignees'],
    queryFn: () => unwrap(api.GET('/api/tasks/assignees')),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Выполнить и вернуть — с обновлением всех списков задач. */
export function useTaskStatus() {
  const client = useQueryClient()
  return useMutation<Task, ApiError, { id: number; done: boolean }>({
    mutationFn: ({ id, done }) => unwrap(done
      ? api.POST('/api/tasks/{id}/done', { params: { path: { id } } })
      : api.POST('/api/tasks/{id}/reopen', { params: { path: { id } } })),
    onSettled: () => client.invalidateQueries({ queryKey: TASKS }),
  })
}

export function useDeleteTask() {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/tasks/{id}', { params: { path: { id } } })),
    onSettled: () => client.invalidateQueries({ queryKey: TASKS }),
  })
}

/** Создать (id нет) или изменить задачу. */
export function useSaveTask() {
  const client = useQueryClient()
  return useMutation<Task, ApiError, { id?: number; body: NewTask }>({
    mutationFn: ({ id, body }) => unwrap(id == null
      ? api.POST('/api/tasks', { body })
      : api.PUT('/api/tasks/{id}', { params: { path: { id } }, body })),
    onSuccess: () => client.invalidateQueries({ queryKey: TASKS }),
  })
}
