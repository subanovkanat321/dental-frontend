import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, type Schemas } from '../api/client'
import { slotInstant } from '../lib/time'
import { applyUpdatedAppointment, rereadOnConflict, sendAppointmentAction } from './useAppointmentAction'
import { durationOf } from './week/weekModel'

type Appointment = Schemas['AppointmentView']

/** Перенос в сетке «Дня»: на какое время и к какому врачу (тот же — просто другое время). */
export type DayMove = { appointment: Appointment; date: string; minutes: number; doctorId: number }

type Snapshot = { keys: { key: readonly unknown[]; before: Appointment[] | undefined }[] }

/** Ключ кэша дня врача в сетке — с хвостами со вчера (overnight), как в SchedulePage. */
export const dayGridKey = (date: string, doctorId: number) => ['appointments', date, doctorId, 'overnight'] as const

/**
 * Перенос перетаскиванием в «Дне» — как в «Неделе» (useMove): блок сразу на новом месте, решает сервер.
 * Тот же врач — /reschedule, другой (колонка коллеги в «Все врачи») — /transfer, как в форме «Перенести»:
 * новому врачу придёт уведомление. Занято или приём успели изменить (409) — блок возвращается.
 */
export function useDayMove(date: string) {
  const client = useQueryClient()
  return useMutation<Appointment, ApiError, DayMove, Snapshot>({
    mutationFn: ({ appointment: a, date: day, minutes, doctorId }) => {
      const body = { version: a.version, startAt: slotInstant(day, minutes), durationMinutes: durationOf(a) }
      return doctorId === a.doctorId
        ? sendAppointmentAction(a.id, { kind: 'reschedule', body })
        : sendAppointmentAction(a.id, { kind: 'transfer', body: { ...body, doctorId } })
    },
    onMutate: async ({ appointment: a, date: day, minutes, doctorId }) => {
      const source = dayGridKey(date, a.doctorId)
      const target = dayGridKey(date, doctorId)
      // Автообновление раз в минуту не должно вернуть старое место поверх нового
      await client.cancelQueries({ queryKey: source })
      if (doctorId !== a.doctorId) await client.cancelQueries({ queryKey: target })
      const keys = [source, ...(doctorId !== a.doctorId ? [target] : [])].map((key) => ({ key, before: client.getQueryData<Appointment[]>(key) }))
      const startAt = slotInstant(day, minutes)
      const moved = { ...a, doctorId, startAt, endAt: new Date(new Date(startAt).getTime() + durationOf(a) * 60_000).toISOString() }
      if (doctorId === a.doctorId) {
        client.setQueryData<Appointment[]>(source, (list) => list?.map((x) => (x.id === a.id ? moved : x)))
      } else {
        client.setQueryData<Appointment[]>(source, (list) => list?.filter((x) => x.id !== a.id))
        client.setQueryData<Appointment[]>(target, (list) => (list ? [...list, moved] : list))
      }
      return { keys }
    },
    onError: (error, _move, snapshot) => {
      for (const { key, before } of snapshot?.keys ?? []) client.setQueryData(key, before)
      rereadOnConflict(client, error)
    },
    onSuccess: (updated, { appointment: a }) => {
      applyUpdatedAppointment(client, updated)
      // Передали другому врачу — дни обоих перечитать: приём ушёл из одной колонки в другую
      if (updated.doctorId !== a.doctorId) void client.invalidateQueries({ queryKey: ['appointments', date] })
    },
  })
}
