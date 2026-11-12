import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'

/**
 * «Не отправилось»: нажали «Напомнить», а сообщение так и не ушло (нет интернета, не тот номер, закрыли
 * WhatsApp). Снимает отметку «напоминание отправлено» — приём снова в «кому ещё напомнить».
 */
export function useReminderNotSent(a: Schemas['AppointmentView']) {
  const client = useQueryClient()
  const undo = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const run = () => void ask(`Напоминание пациенту ${a.patient.fullName} не ушло? Снимем отметку «отправлено» — можно будет напомнить ещё раз.`,
    { ok: 'Не ушло — снять отметку' }).then((ok) => ok && undo.mutate())
  return { run, undo }
}
