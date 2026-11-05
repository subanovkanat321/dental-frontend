import type { Schemas } from '../api/client'
import { addDays, dateOf, shortDate, timeOf, todayIn } from '../lib/time'

type Appointment = Schemas['AppointmentView']

/** Так сервер называет отмену пациентом и автоматическую (AppointmentView.cancelledBy). */
const BY_PATIENT = 'пациент в боте'
const BY_SYSTEM = 'автоматически'

/** Когда отменили: «14:20» сегодня (в карточке — «сегодня 14:20»), «вчера 18:05», «3 нояб, 10:30». */
export function cancelledWhen(at: string, { today = todayIn(), sayToday = false } = {}): string {
  const day = dateOf(at)
  if (day === today) return sayToday ? `сегодня ${timeOf(at)}` : timeOf(at)
  if (day === addDays(today, -1)) return `вчера ${timeOf(at)}`
  return shortDate(at, true)
}

/** Кто отменил словами: «отменил пациент в боте», «отменил(а) Айгерим Садыкова»; до V160 не записано — «отменена». */
export function cancelledWho(a: Appointment): string {
  if (!a.cancelledBy) return 'отменена'
  if (a.cancelledBy === BY_PATIENT) return 'отменил пациент в боте'
  if (a.cancelledBy === BY_SYSTEM) return 'отменена автоматически'
  return `отменил(а) ${a.cancelledBy}`
}

/** Строка в списке отменённых: «отменил пациент в боте · 14:20». */
export function cancelledText(a: Appointment): string {
  return a.cancelledAt ? `${cancelledWho(a)} · ${cancelledWhen(a.cancelledAt)}` : cancelledWho(a)
}
