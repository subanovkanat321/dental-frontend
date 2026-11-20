/** Instagram Tish (платформы, не клиники): видео-инструкции, советы, новости. Один адрес на всё приложение. */
export const TISH_INSTAGRAM = 'https://www.instagram.com/tish.app.kg/'
export const TISH_INSTAGRAM_NAME = '@tish.app.kg'

/**
 * Оффер для клиник — одной фразой везде (/go, /start, /join, /about, подписи Instagram). Срок пробного периода не
 * называем (владелец, 2026-11-04 и 2026-11-20): в коде он — настройка «Платформа → Тарифы» (pilot_months).
 */
export const OFFER = 'Попробовать бесплатно'

/**
 * Ссылка для шапки Instagram: tish.kg/ig → регистрация клиники с меткой канала (nginx, иначе — SPA). Регистрация
 * запишется «из Instagram» и будет видна в «Платформа → Аналитика → Откуда пришли клиники» (V237 бэкенда).
 */
export const INSTAGRAM_SIGNUP = '/start?from=instagram'
