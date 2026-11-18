import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useReminderText, useRepeatReminderText } from '../api/settings'
import { contactPhone } from '../lib/guardian'
import { openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { useAppointmentAction } from './useAppointmentAction'

type Appointment = Schemas['AppointmentView']

/** Пациент без бота и без номера (своего или представителя) — напомнить некуда */
export const NOWHERE_TEXT = 'Нет Telegram и номера — позвоните или добавьте номер в карточке'

/**
 * Напомнить о приёме — один путь для карточки (Remind), быстрой кнопки и свайпа в «Дне»:
 * - пациент в боте — POST remind-telegram (сервер сам кладёт предоплату и QR и ставит отметку);
 *   не доставлено (409 not-delivered: удалил чат, бот выключен) — notDelivered, CRM предлагает WhatsApp;
 * - нет бота, есть номер (представителя — в первую очередь, contactPhone) — WhatsApp с готовым текстом
 *   настроек (тот же, что у карточки, с предоплатой) и отметка reminder-opened;
 * - ни бота, ни номера — nowhere: напоминать некуда (NOWHERE_TEXT).
 * Текст повтора («Напоминаем ещё раз…») — когда уже напоминали.
 */
export function useRemind(a: Appointment) {
  const client = useQueryClient()
  const action = useAppointmentAction(a)
  const first = useReminderText()
  const again = useRepeatReminderText()
  const opened = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/appointments/{id}/reminder-opened', { params: { path: { id: a.id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['appointments'] }),
  })
  const phone = contactPhone(a.patient)
  const viaBot = Boolean(a.patient.telegram)
  const repeat = Boolean(a.reminderOpenedAt)
  /** Текст для WhatsApp/SMS; null — настройки ещё грузятся */
  const text = (repeat ? again : first)?.(a) ?? null

  /** В бот; onSent — после ответа сервера (отметка уже стоит) */
  const telegram = (onSent?: () => void) => {
    action.reset()
    action.mutate({ kind: 'remindTelegram' }, { onSuccess: () => onSent?.() })
  }
  /** WhatsApp с готовым текстом и отметка «напомнили». false — некуда или текст ещё не готов */
  const whatsapp = (): boolean => {
    if (!phone || text == null) return false
    opened.mutate()
    // openLink: в Telegram ссылка откроется во внешнем браузере / WhatsApp, а не внутри Mini App
    openLink(whatsappUrl(phone, text))
    return true
  }
  return {
    action,
    opened,
    phone,
    viaBot,
    text,
    nowhere: !viaBot && !phone,
    notDelivered: action.error?.code === 'not-delivered',
    pending: action.isPending || opened.isPending,
    telegram,
    whatsapp,
  }
}
