import type { Schemas } from '../api/client'
import { applyTemplate, usesVariable } from './reminderTemplate'
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

/** SMS с телефона, где открыто приложение: «Сообщения» с номером и текстом (форма ссылки — для iPhone и Android). */
export function smsUrl(phone: string, text: string): string {
  return `sms:${phone ? `+${phone}` : ''}?&body=${encodeURIComponent(text)}`
}

export function whatsappUrl(phone: string, text: string, windows: boolean = isWindows()): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(windows ? withoutEmoji(text) : text)}`
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

/**
 * WhatsApp на компьютере с Windows принимает текст из ссылки wa.me с ошибкой: эмодзи (символы вне основной
 * таблицы Юникода, 😊 👇 🙏) приходят знаком «�». Там — без них; пробелы, оставшиеся вместо эмодзи, — одним.
 * На телефонах и Mac эмодзи доходят как есть.
 */
export function withoutEmoji(text: string): string {
  return text
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/\uFE0F|\u200D|\u20E3/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function signed(text: string, signature?: string | null): string {
  return signature ? `${text} ${signature}` : text
}

/** «больше полугода»: срок профосмотра словами (после «больше» — родительный падеж). */
function periodText(months?: number | null): string {
  if (months == null || months === 6) return 'полугода'
  if (months === 1) return 'месяца'
  if (months === 12) return 'года'
  if (months === 24) return 'двух лет'
  return `${months} месяцев`
}

/** «Пора на профосмотр»: срок — у услуги последнего визита или у клиники (по умолчанию полгода). */
export function recallText(fullName: string, signature?: string | null, months?: number | null): string {
  return signed(`Здравствуйте, ${fullName}! 😊 Прошло больше ${periodText(months)} с вашего визита к стоматологу — `
    + 'пора на профилактический осмотр 🦷 Ответьте, когда вам удобно, — запишем.', signature)
}

/** «Освободилось время» — пациенту из листа ожидания. */
export function freeSlotText(fullName: string, startAt: string, signature?: string | null, now = new Date()): string {
  return signed(`Здравствуйте, ${fullName}! 🔔 Освободилось время у стоматолога: ${whenText(startAt, now)} `
    + `в ${timeOf(startAt)}. Хотите прийти? Ответьте «да» — запишем 😊`, signature)
}

/** Строка-приглашение в бота клиники под напоминанием в WhatsApp/SMS. */
export const BOT_LINE = '📲 Записываться самим и получать напоминания можно в Telegram:'

/** В WhatsApp/SMS кнопок нет — как ответить, дописываем сами (и к своему тексту клиники). */
export const REPLY_LINE = 'Ответьте 1 — приду, 2 — перенести.'

/** Что из /api/settings нужно для напоминания: подпись, бот и свой текст клиники с её данными. */
export type ReminderSettings = Partial<Pick<Schemas['SettingsControllerSettings'],
  'clinicSignature' | 'botUrl' | 'reminderTemplate' | 'clinicName' | 'clinicAddress' | 'clinicPhone'>>

type ReminderAppointment = {
  startAt: string; serviceName?: string | null; patient: { fullName?: string; telegram?: boolean; guardian?: { fullName?: string } | null }
}

/**
 * {когда} в своём тексте — как у бота (Lang.when бэкенда): «сегодня в 10:00», «завтра в 10:00»
 * или «понедельник, 26 октября, в 10:00».
 */
export function whenAt(startAt: string, now = new Date()): string {
  const day = dateOf(startAt)
  const today = todayIn(now)
  const time = `в ${timeOf(startAt)}`
  if (day === today) return `сегодня ${time}`
  if (day === addDays(today, 1)) return `завтра ${time}`
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${day}T00:00:00Z`))
  return `${date}, ${time}`
}

/**
 * Напоминание о приёме в WhatsApp/SMS. Свой текст клиники (reminderTemplate) — тот же шаблон, что
 * у бота; нет его — стандартный текст. К тексту дописываем сами:
 * - «Ответьте 1 — приду, 2 — перенести.» — у своего текста (в стандартном она уже есть);
 * - подпись клиники — если в шаблоне нет {клиника};
 * - ссылку на бота клиники отдельной строкой — пациенту, который ещё не в боте, если в шаблоне
 *   нет {бот} (иначе ссылка там, куда её поставила клиника).
 * Адрес отдельной строкой, как бот, не дописываем: в WhatsApp он только через {адрес}.
 *
 * У ребёнка с представителем (V164) пишем представителю (как PatientReminders бэкенда): «Здравствуйте, Айгуль!
 * Запись ребёнка Аружан: …»; в своём тексте {имя} — имя представителя, первой строкой «👶 Запись ребёнка Аружан».
 */
export function reminderText(a: ReminderAppointment, settings?: ReminderSettings | null, doctor?: string | null,
  now = new Date()): string {
  const template = settings?.reminderTemplate?.trim()
  const botUrl = settings?.botUrl
  const signature = settings?.clinicSignature
  const invite = (text: string) => (botUrl && !a.patient.telegram ? `${text}\n\n${BOT_LINE} ${botUrl}` : text)
  // Адрес — как в Telegram: отдельной строкой, если клиника не вставила {адрес} в свой текст сама
  const address = settings?.clinicAddress?.trim() ? `📍 Адрес: ${settings.clinicAddress.trim()}` : null
  const guardian = a.patient.guardian?.fullName
  const greet = guardian ?? a.patient.fullName
  if (!template) {
    const text = `Здравствуйте, ${greet}! 👋 ${guardian ? `Запись ребёнка ${a.patient.fullName}:` : 'Напоминаем:'} `
      + `${whenText(a.startAt, now)} в ${timeOf(a.startAt)} приём у стоматолога 🦷 ${REPLY_LINE}`
    // Без адреса — как раньше (подпись через пробел); с адресом — строками: текст, адрес, подпись
    return invite(address ? [text, address, signature].filter(Boolean).join('\n') : signed(text, signature))
  }
  const filled = applyTemplate(template, {
    имя: greet, когда: whenAt(a.startAt, now), врач: doctor, услуга: a.serviceName,
    клиника: settings?.clinicName, адрес: settings?.clinicAddress, телефон: settings?.clinicPhone, бот: botUrl,
  })
  const body = guardian ? `👶 Запись ребёнка ${a.patient.fullName}\n${filled}` : filled
  const lines = [body, REPLY_LINE]
  if (address && !usesVariable(template, 'адрес')) lines.push(address)
  if (signature && !usesVariable(template, 'клиника')) lines.push(signature)
  const text = lines.join('\n')
  return usesVariable(template, 'бот') ? text : invite(text)
}
