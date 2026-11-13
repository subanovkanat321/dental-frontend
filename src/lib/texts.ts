import type { Schemas } from '../api/client'
import { applyTemplate, usesVariable } from './reminderTemplate'
import { addDays, dateOf, timeOf, todayIn } from './time'

/**
 * Тексты пациентам в WhatsApp — те же, что в приложении (static/js/state.js бэкенда): одна клиника
 * не должна писать по-разному из CRM и из Telegram. Ссылка wa.me собирается в браузере: телефон
 * не попадает ни в адрес CRM, ни на сервер.
 */

const WEEKDAY_ON = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу']

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

/** Звали меньше 7 дней назад — перед повтором спросить «Позвать ещё раз?». */
export function recentlyInvited(invitedAt: string, now = new Date()): boolean {
  return now.getTime() - Date.parse(invitedAt) < 7 * 86400000
}

/** SMS с телефона, где открыто приложение: «Сообщения» с номером и текстом (форма ссылки — для iPhone и Android). */
export function smsUrl(phone: string, text: string): string {
  return `sms:${phone ? `+${phone}` : ''}?&body=${encodeURIComponent(text)}`
}

/**
 * На телефоне — wa.me: ссылку сразу берёт приложение WhatsApp. На компьютере wa.me сначала переадресует на
 * api.whatsapp.com и при этом раскодирует «+» в пробел («ответьте «+»» приходило «ответьте « »»), поэтому
 * там ссылка сразу на api.whatsapp.com/send — без переадресации «+» доходит как есть.
 */
export function whatsappUrl(phone: string, text: string, windows: boolean = isWindows(), mobile: boolean = isMobile()): string {
  const body = encodeURIComponent(safePlus(windows ? withoutEmoji(text) : text))
  return mobile
    ? `https://wa.me/${phone}?text=${body}`
    : `https://api.whatsapp.com/send/?${phone ? `phone=${phone}&` : ''}text=${body}`
}

/**
 * Одиночный «+» («ответьте «+»») WhatsApp по дороге превращает в пробел — и с телефона (wa.me), и с компьютера:
 * ссылка проходит через переадресации, где «+» в адресе значит «пробел». Такой «+» заменяем на «＋» (U+FF0B) —
 * выглядит так же, но в адресе это обычная буква. «+996…» в номерах не трогаем: там важна ссылка-номер.
 */
export function safePlus(text: string): string {
  return text.replace(/\+(?!\d)/g, '\uFF0B')
}

export function isMobile(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

/**
 * WhatsApp на компьютере с Windows принимает текст из ссылки wa.me с ошибкой: эмодзи (и «двойные», и многие простые)
 * приходят знаком «�». Там эмодзи убираем совсем — текст сразу в поле, без копирования; на телефонах и Mac — как есть.
 */
export function withoutEmoji(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F|\u200D|\u20E3/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    // Строка начиналась с эмодзи («📅 запись по врачам…» в тексте к ролику) — без него не начинаем её с пробела
    .replace(/\n[ \t]+/g, '\n')
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

/** «жарым жылдан»: срок профосмотра по-кыргызски (после него — «ашты»). */
function periodKy(months?: number | null): string {
  if (months == null || months === 6) return 'жарым жылдан'
  if (months === 1) return 'бир айдан'
  if (months === 12) return 'бир жылдан'
  if (months === 24) return 'эки жылдан'
  return `${months} айдан`
}

/** «бүгүн», «кечээ», «5 күн мурун», «2 ай мурун» — agoText по-кыргызски. */
function agoKy(instant: string, now = new Date()): string {
  const days = Math.round((Date.parse(`${todayIn(now)}T00:00:00Z`) - Date.parse(`${dateOf(instant)}T00:00:00Z`)) / 86400000)
  if (days <= 0) return 'бүгүн'
  if (days === 1) return 'кечээ'
  return days < 60 ? `${days} күн мурун` : `${Math.floor(days / 30)} ай мурун`
}

/**
 * «Пора на профосмотр»: срок — у услуги последнего визита или у клиники (по умолчанию полгода). Уже звали
 * (`invitedAt`) — повтор короче и мягче: «Мы писали вам 5 дней назад — напоминаем ещё раз…», как
 * повтор приглашения «Позвать снова» бэкенда (Comebacks.repeatTemplate). Язык — если известен, иначе русский
 * (у пациента без бота CRM его не знает).
 */
export function recallText(fullName: string, signature?: string | null, months?: number | null,
  options: { invitedAt?: string | null; lang?: 'ru' | 'ky'; now?: Date } = {}): string {
  const { invitedAt, lang = 'ru', now = new Date() } = options
  if (lang === 'ky') {
    return signed(invitedAt
      ? `Саламатсызбы, ${fullName}! Сизге ${agoKy(invitedAt, now)} жазганбыз — дагы бир жолу эскертебиз: `
        + 'профилактикалык текшерүүгө убакыт келди 🦷 Качан ыңгайлуу экенин жазыңыз — жазып коёбуз.'
      : `Саламатсызбы, ${fullName}! 😊 Тиш дарыгерине келгениңизге ${periodKy(months)} ашты — `
        + 'профилактикалык текшерүүгө убакыт келди 🦷 Качан ыңгайлуу экенин жазыңыз — жазып коёбуз.', signature)
  }
  return signed(invitedAt
    ? `Здравствуйте, ${fullName}! Мы писали вам ${agoText(invitedAt, now)} — напоминаем ещё раз: `
      + 'пора на профилактический осмотр 🦷 Ответьте, когда вам удобно, — запишем.'
    : `Здравствуйте, ${fullName}! 😊 Прошло больше ${periodText(months)} с вашего визита к стоматологу — `
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

const KY_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const KY_WEEKDAYS = ['жекшемби', 'дүйшөмбү', 'шейшемби', 'шаршемби', 'бейшемби', 'жума', 'ишемби']

/** {когда} по-кыргызски — как Lang.KY.when бэкенда: «бүгүн саат 10:00», «эртең саат 10:00», «26-октябрь, дүйшөмбү, саат 10:00». */
export function whenAtKy(startAt: string, now = new Date()): string {
  const day = dateOf(startAt)
  const today = todayIn(now)
  const time = `саат ${timeOf(startAt)}`
  if (day === today) return `бүгүн ${time}`
  if (day === addDays(today, 1)) return `эртең ${time}`
  const date = new Date(`${day}T00:00:00Z`)
  return `${date.getUTCDate()}-${KY_MONTHS[date.getUTCMonth()]}, ${KY_WEEKDAYS[date.getUTCDay()]}, ${time}`
}

/** «Ответьте 1 — приду, 2 — перенести» по-кыргызски. */
const REPLY_LINE_KY = 'Жооп бериңиз: 1 — келем, 2 — жылдыруу керек.'

/**
 * Повторное напоминание в WhatsApp/SMS (уже напоминали) — другим текстом, чтобы пациент не получил то же
 * сообщение дважды; как PatientReminders.repeatText бэкенда (reminder.repeat). Всегда системный текст:
 * свой шаблон клиники — только для первого напоминания. Язык — если известен (CRM знает его только у
 * пациентов в боте, а им повтор уходит в Telegram), иначе русский. Строка «Ответьте 1 — приду…» и ссылка
 * на бота — как у первого.
 */
export function repeatReminderText(a: ReminderAppointment, settings?: ReminderSettings | null, doctor?: string | null,
  now = new Date(), lang: 'ru' | 'ky' = 'ru'): string {
  const guardian = a.patient.guardian?.fullName
  const greet = guardian ?? a.patient.fullName
  const clinic = settings?.clinicName?.trim()
  const address = settings?.clinicAddress?.trim()
  const where = [clinic, address].filter(Boolean).join(', ')
  const botUrl = settings?.botUrl
  let text: string
  if (lang === 'ky') {
    text = `Саламатсызбы, ${greet}! Дагы бир жолу эскертебиз: ${whenAtKy(a.startAt, now)} `
      + `${doctor ? `${doctor} дарыгердин` : 'тиш дарыгеринин'} кабыл алуусуна жазылгансыз${where ? ` (${where})` : ''}. `
      + 'Келесизби, жооп бериңизчи — пландарыңыз өзгөрсө, бул убакытты башка бейтапка бере алабыз.'
    if (guardian) text = `👶 Балаңыз ${a.patient.fullName} жазылган\n${text}`
    text += `\n${REPLY_LINE_KY}`
  }
  else {
    text = `Здравствуйте, ${greet}! Напоминаем ещё раз: ${whenAt(a.startAt, now)} у вас приём `
      + `${doctor ? `у врача ${doctor}` : 'у стоматолога'}${where ? ` в ${where}` : ''}. `
      + 'Пожалуйста, ответьте, придёте ли — так мы сможем отдать время другому пациенту, если планы поменялись.'
    if (guardian) text = `👶 Запись ребёнка ${a.patient.fullName}\n${text}`
    text += `\n${REPLY_LINE}`
  }
  return botUrl && !a.patient.telegram ? `${text}\n\n${BOT_LINE} ${botUrl}` : text
}

/** «⏰ Ждём вас» за 2 часа до приёма — soon.text бэкенда (SoonReminders); клиника его не меняет. */
export function soonText(startAt: string, settings?: ReminderSettings | null, now = new Date()): string {
  const lines = [`⏰ Ждём вас ${whenAt(startAt, now)} на приёме у стоматолога 😊`]
  if (settings?.clinicAddress?.trim()) lines.push(`📍 Адрес: ${settings.clinicAddress.trim()}`)
  if (settings?.clinicPhone?.trim()) lines.push(`📞 Не получается прийти — позвоните, пожалуйста: ${settings.clinicPhone.trim()}`)
  return lines.join('\n')
}

/** Пустой шаблон переезда в Tish — открытая ссылка бэкенда (данных клиники в нём нет): один .xlsx на все данные. */
export const MOVE_TEMPLATE_PATH = '/web/import/tish-perenos.xlsx'
