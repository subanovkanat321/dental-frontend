import { addDays, timeOf, todayIn, ZONE } from './time'

/**
 * Тексты пациентам в WhatsApp — те же, что в приложении (static/js/state.js бэкенда): одна клиника
 * не должна писать по-разному из CRM и из Telegram. Ссылка wa.me собирается в браузере: телефон
 * не попадает ни в адрес CRM, ни на сервер.
 */

const WEEKDAY_ON = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу']

function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

/** «сегодня», «завтра» или «в пятницу, 7 ноября» — по Бишкеку. */
function whenText(startAt: string, now = new Date()): string {
  const day = dateOf(startAt)
  const today = todayIn(now)
  if (day === today) return 'сегодня'
  if (day === addDays(today, 1)) return 'завтра'
  const date = new Date(`${day}T00:00:00Z`)
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(date)
  return `${WEEKDAY_ON[date.getUTCDay()]}, ${dayMonth}`
}

/** «сегодня», «вчера», «5 дней назад», «2 мес назад». */
export function agoText(instant: string, now = new Date()): string {
  const days = Math.round((Date.parse(`${todayIn(now)}T00:00:00Z`) - Date.parse(`${dateOf(instant)}T00:00:00Z`)) / 86400000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 60) {
    const mod100 = days % 100
    const mod10 = days % 10
    const word = mod100 >= 11 && mod100 <= 14 ? 'дней' : mod10 === 1 ? 'день' : mod10 >= 2 && mod10 <= 4 ? 'дня' : 'дней'
    return `${days} ${word} назад`
  }
  return `${Math.floor(days / 30)} мес назад`
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

function signed(text: string, signature?: string | null): string {
  return signature ? `${text} ${signature}` : text
}

/** «Пора на профосмотр» — тем, кто был больше полугода назад. */
export function recallText(fullName: string, signature?: string | null): string {
  return signed(`Здравствуйте, ${fullName}! 😊 Прошло больше полугода с вашего визита к стоматологу — `
    + 'пора на профилактический осмотр 🦷 Ответьте, когда вам удобно, — запишем.', signature)
}

/** «Освободилось время» — пациенту из листа ожидания. */
export function freeSlotText(fullName: string, startAt: string, signature?: string | null, now = new Date()): string {
  return signed(`Здравствуйте, ${fullName}! 🔔 Освободилось время у стоматолога: ${whenText(startAt, now)} `
    + `в ${timeOf(startAt)}. Хотите прийти? Ответьте «да» — запишем 😊`, signature)
}

/** Напоминание о приёме: «1 — приду, 2 — перенести»; без бота — ссылка на бота клиники. */
export function reminderText(a: { startAt: string; patient: { fullName?: string; telegram?: boolean } },
  signature?: string | null, botUrl?: string | null, now = new Date()): string {
  const text = signed(`Здравствуйте, ${a.patient.fullName}! 👋 Напоминаем: ${whenText(a.startAt, now)} в ${timeOf(a.startAt)} `
    + 'приём у стоматолога 🦷 Ответьте 1 — приду, 2 — перенести.', signature)
  return botUrl && !a.patient.telegram
    ? `${text}\n\n📲 Записываться самим и получать напоминания можно в Telegram: ${botUrl}`
    : text
}
