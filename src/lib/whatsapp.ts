import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

export type ClinicWhatsApp = Schemas['WhatsAppAdminClinicView']
type Mark = Schemas['MessengerMarksWhatsAppMark']

export const WHATSAPP_KEY = ['clinic-whatsapp']

/**
 * WhatsApp клиники через Tish (официальный Cloud API, V256 бэкенда): подключён ли, какие сообщения шлёт, шаблоны и
 * последние сообщения. Видят все сотрудники (без номеров и текстов); менять — руководитель («Настройки → WhatsApp»).
 */
export function useClinicWhatsApp(enabled = true) {
  return useQuery({
    queryKey: WHATSAPP_KEY,
    queryFn: () => unwrap(api.GET('/api/clinic/whatsapp')),
    staleTime: 5 * 60_000,
    enabled,
  })
}

/** Шаблон этого вида утверждён Meta хотя бы на одном языке — сообщение может уйти. */
export function approved(wa: ClinicWhatsApp | undefined, kind: 'CONFIRMATION' | 'REMINDER' | 'SOON'): boolean {
  return Boolean(wa?.templates?.some((t) => t.kind === kind && t.status === 'APPROVED'))
}

/** Напоминание накануне можно отправить через WhatsApp Tish: подключён, включено и шаблон утверждён. */
export function canRemindViaWhatsApp(wa: ClinicWhatsApp | undefined): boolean {
  return Boolean(wa?.connected && wa.reminder && approved(wa, 'REMINDER'))
}

/** Статус сообщения словами (то, что приходит от Meta). */
export function statusText(status: string | undefined): string {
  switch (status) {
    case 'QUEUED': case 'SENDING': return 'отправляется'
    case 'SENT': return 'отправлено'
    case 'DELIVERED': return 'доставлено'
    case 'READ': return 'прочитано'
    case 'FAILED': return 'не доставлено'
    default: return status ?? '—'
  }
}

/** Тон статуса: доставлено и прочитано — зелёный, не доставлено — красный, остальное — ожидание. */
export function statusTone(status: string | undefined): 'ok' | 'bad' | 'wait' {
  if (status === 'DELIVERED' || status === 'READ') return 'ok'
  if (status === 'FAILED') return 'bad'
  return 'wait'
}

/** Вид сообщения словами. */
export function kindText(kind: string | undefined): string {
  switch (kind) {
    case 'CONFIRMATION': return 'Вы записаны'
    case 'REMINDER': return 'Напоминание накануне'
    case 'SOON': return 'За 2 часа'
    case 'REPLY': return 'Ответ на кнопку'
    case 'ANSWER': return 'Ответ на вопрос'
    default: return kind ?? ''
  }
}

/** «📲 WhatsApp: прочитано» — у приёма, о котором Tish писал в WhatsApp; нет сообщения — null. */
export function markText(mark: Mark | undefined | null): string | null {
  return mark ? `📲 WhatsApp: ${statusText(mark.status)}` : null
}

/** Статус шаблона Meta словами. */
export function templateStatusText(status: string | undefined): string {
  switch (status) {
    case 'APPROVED': return 'утверждён'
    case 'PENDING': return 'на проверке'
    case 'REJECTED': return 'отклонён'
    case 'PAUSED': return 'приостановлен'
    case 'DISABLED': return 'отключён'
    case 'ERROR': return 'ошибка подачи'
    default: return 'не отправлен'
  }
}
