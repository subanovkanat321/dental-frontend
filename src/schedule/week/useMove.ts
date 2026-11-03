import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ApiError, type Schemas } from '../../api/client'
import { slotInstant } from '../../lib/time'
import { applyUpdatedAppointment, rereadOnConflict, sendAppointmentAction } from '../useAppointmentAction'
import { durationOf } from './weekModel'
import { weekKey } from './useWeek'

type Appointment = Schemas['AppointmentView']

export type Move = { appointment: Appointment; date: string; minutes: number }

type Snapshot = { key: readonly unknown[]; before: Appointment[] | undefined }

/**
 * Перенос перетаскиванием — без «Вы уверены?»: блок сразу встаёт на новое место (оптимистично), а
 * решает сервер — тот же /reschedule с версией приёма, что у формы «Перенести». Время занято или приём
 * успели изменить (409) — блок возвращается, и показываем ответ сервера.
 */
export function useMove(monday: string, doctorId: number) {
  const client = useQueryClient()
  const key = weekKey(monday, doctorId)
  return useMutation<Appointment, ApiError, Move, Snapshot>({
    mutationFn: ({ appointment: a, date, minutes }) => sendAppointmentAction(a.id!, {
      kind: 'reschedule',
      body: { version: a.version ?? 0, startAt: slotInstant(date, minutes), durationMinutes: durationOf(a) },
    }),
    onMutate: async ({ appointment: a, date, minutes }) => {
      // Автообновление раз в минуту не должно вернуть старое место поверх нового
      await client.cancelQueries({ queryKey: key })
      const before = client.getQueryData<Appointment[]>(key)
      const startAt = slotInstant(date, minutes)
      const endAt = new Date(new Date(startAt).getTime() + durationOf(a) * 60_000).toISOString()
      client.setQueryData<Appointment[]>(key, (list) => list?.map((x) => (x.id === a.id ? { ...x, startAt, endAt } : x)))
      return { key, before }
    },
    onError: (error, _move, snapshot) => {
      if (snapshot) client.setQueryData(snapshot.key, snapshot.before)
      rereadOnConflict(client, error)
    },
    onSuccess: (updated) => applyUpdatedAppointment(client, updated),
  })
}
