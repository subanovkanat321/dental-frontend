import type { Schemas } from '../api/client'

export type Channel = Schemas['TishReportControllerChannelRow']['channel']

/** Каналы Tish (бэкенд, `BookingChannel`, V232) — как их видит руководитель в «Пациентах от Tish». */
export const CHANNEL_LABELS: Record<Channel, string> = {
  BOT: '🤖 Чат бота',
  MINI_APP: '📲 Mini App в Telegram',
  SITE: '🌐 Сайт клиники',
  INSTAGRAM: '📱 Instagram',
  TWOGIS: '🗺 2ГИС',
  WHATSAPP: '💬 WhatsApp-статус',
  REELS: '🎬 Рилсы',
  QR: '🔳 QR на ресепшн',
  REFERRAL: '🤝 Приведи друга',
  RECALL: '🔁 Возврат пациентов',
}

/**
 * Ссылки записи с меткой канала: `/c/<код>?from=<метка>`. Метки — те же, что понимает сервер
 * (`BookingChannel.slug`); страница клиники передаст метку и в бота (start=c_<код>_<метка>), и в форму записи.
 */
export const LINK_CHANNELS: { channel: Channel; slug: string; title: string; where: string }[] = [
  { channel: 'INSTAGRAM', slug: 'instagram', title: 'Instagram', where: 'Шапка профиля → «Изменить профиль» → «Ссылки»' },
  { channel: 'TWOGIS', slug: '2gis', title: '2ГИС', where: 'Карточка клиники в 2ГИС → поле «Сайт»' },
  { channel: 'WHATSAPP', slug: 'whatsapp', title: 'WhatsApp-статус', where: 'Статус или описание профиля WhatsApp Business' },
  { channel: 'REELS', slug: 'reels', title: 'Рилсы', where: 'Подпись к рилсу или ссылка в истории' },
  { channel: 'QR', slug: 'qr', title: 'QR на ресепшн', where: 'Распечатайте QR и поставьте у стойки — запишутся на следующий визит' },
]

/** Ссылка записи клиники с меткой канала. */
export const channelLink = (origin: string, clinicCode: string, slug: string) => `${origin}/c/${clinicCode}?from=${slug}`
