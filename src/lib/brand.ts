/** Instagram Tish (платформы, не клиники): видео-инструкции, советы, новости. Один адрес на всё приложение. */
export const TISH_INSTAGRAM = 'https://www.instagram.com/tish.app.kg/'
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
