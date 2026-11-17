import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { contactPhone } from '../lib/guardian'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'

type Appointment = Schemas['AppointmentView']
type Sent = Schemas['ReviewLinksSent']

/**
 * «⭐ Попросить оценку» (V222 бэкенда): пациенту без Telegram бот «Как прошёл приём?» не напишет — отправляем
 * ссылку на страницу оценки в WhatsApp. Ссылку и текст делает сервер (секрет ссылки — только у него), фронт
 * открывает WhatsApp. Каждое нажатие — новая ссылка; прежние работают до первой оценки.
 */
export function useSendReview() {
  const client = useQueryClient()
  return useMutation<Sent, ApiError, number>({
    mutationFn: (id) => unwrap(api.POST('/api/appointments/{id}/review-link', { params: { path: { id } } })),
    onSuccess: (sent, id) => {
      haptic('success')
      openLink(whatsappUrl(sent.phone, sent.text))
      void client.invalidateQueries({ queryKey: ['review-link', id] })
      void client.invalidateQueries({ queryKey: ['review-asks'] })
    },
    onError: () => haptic('error'),
  })
}

/** Показывать ли блок в карточке: приём состоялся, оценки нет, пациент без Telegram и с телефоном. */
export function asksReview(a: Appointment): boolean {
  return a.status === 'DONE' && a.rating == null && !a.patient.telegram && Boolean(contactPhone(a.patient))
}

/** Пациенты без Telegram, у которых можно попросить оценку (сегодня и вчера) — для плашки над расписанием. */
export function useReviewAsks(enabled: boolean) {
  return useQuery({
    queryKey: ['review-asks'],
    queryFn: () => unwrap(api.GET('/api/appointments/review-asks')),
    enabled,
    staleTime: 60_000,
  })
}
