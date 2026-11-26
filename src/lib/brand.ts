/** Instagram Tish (платформы, не клиники): видео-инструкции, советы, новости. Один адрес на всё приложение. */
export const TISH_INSTAGRAM = 'https://www.instagram.com/tish.app.kg/'
/** Бот Tish в Telegram — запись пациентов и вход сотрудников (в JSON-LD главной — sameAs, index.html). */
export const TISH_BOT = 'https://t.me/dental_stom_bot'
/** Канал Tish в Telegram для стоматологов: новости и советы (подвал главной, контакты /about, sameAs в index.html). */
export const TISH_CHANNEL = 'https://t.me/+tYKBuv9OgZ40YTky'
export const TISH_INSTAGRAM_NAME = '@tish.app.kg'

/**
 * Оффер для клиник — одной фразой везде (/go, /start, /join, /about, подписи Instagram). С 2026-11-25 Tish бесплатный
 * для всех (владелец: «сделаем везде открытым и бесплатным»): не «попробовать», а сразу «начать» — пробного срока нет.
 */
export const OFFER = 'Начать бесплатно'

/** Что Tish бесплатный — одной строкой для сайта (/join, /about, /tour). Без цен, сроков и «договоримся об условиях». */
export const FREE_LINE = 'Tish бесплатный: всё приложение, без ограничений, пробного срока и оплаты.'

/**
 * Ссылка для шапки Instagram: tish.kg/ig → регистрация клиники с меткой канала (nginx, иначе — SPA). Регистрация
 * запишется «из Instagram» и будет видна в «Платформа → Аналитика → Откуда пришли клиники» (V237 бэкенда).
 */
export const INSTAGRAM_SIGNUP = '/start?from=instagram'

/**
 * Связь с Tish по умолчанию — те же адреса, что были на /about. Страницы сайта сначала берут контакты из «Сведений о
 * платформе» (GET /web/links: supportWhatsapp, supportUrl), а эти — если там пусто или сервер не ответил.
 */
export const TISH_TELEGRAM = 'https://t.me/veratti_16'
export const TISH_WHATSAPP = '996773565895'
export const TISH_PHONE = '996558162998'

/** Ссылка WhatsApp Tish с готовым первым сообщением; number — из «Сведений о платформе», иначе {@link TISH_WHATSAPP}. */
export function tishWhatsapp(text?: string, number: string = TISH_WHATSAPP): string {
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}
