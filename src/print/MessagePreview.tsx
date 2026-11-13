import { isWindows, withoutEmoji } from '../lib/texts'

export type Channel = 'TELEGRAM' | 'WHATSAPP'

/**
 * «Так увидит пациент» — точный текст сообщения перед отправкой: заголовок клиники, текст, «Уход дома»,
 * подпись. Текст — с сервера (тот же, что уйдёт в бот и в WhatsApp), здесь его не собираем. Пузырь —
 * как в мессенджере: переносы строк как есть. WhatsApp на компьютере с Windows эмодзи не принимает
 * (whatsappUrl их убирает) — показываем без них и говорим об этом.
 *
 * @param parts сколько сообщений Telegram (длиннее 4000 знаков бот делит по строкам)
 */
export function MessagePreview({ text, channel, parts = 1, label = 'Предпросмотр сообщения' }: {
  text: string
  channel: Channel
  parts?: number
  label?: string
}) {
  const noEmoji = channel === 'WHATSAPP' && isWindows()
  const shown = noEmoji ? withoutEmoji(text) : text
  return (
    <div className="msg-preview" data-channel={channel.toLowerCase()}>
      <div className="msg-bubble" role="document" aria-label={label}>{shown}</div>
      {channel === 'TELEGRAM' && parts > 1 && (
        <p className="hint small">Длинное: в Telegram придёт {parts} сообщениями подряд — бот делит текст по строкам.</p>
      )}
      {noEmoji && <p className="hint small">На компьютере с Windows WhatsApp не принимает эмодзи — они будут убраны, как здесь.</p>}
      {channel === 'WHATSAPP' && <p className="hint small">Откроется WhatsApp с этим текстом — нажмите там «Отправить».</p>}
    </div>
  )
}

/** «Telegram / WhatsApp» — куда отправить и в каком виде показать; один канал — переключателя нет. */
export function ChannelSwitch({ value, telegram, whatsapp, onChange }: {
  value: Channel; telegram: boolean; whatsapp: boolean; onChange: (c: Channel) => void
}) {
  if (!telegram || !whatsapp) return null
  return (
    <div className="segments" role="group" aria-label="Куда отправить">
      <button type="button" aria-pressed={value === 'TELEGRAM'} onClick={() => onChange('TELEGRAM')}>Telegram</button>
      <button type="button" aria-pressed={value === 'WHATSAPP'} onClick={() => onChange('WHATSAPP')}>WhatsApp</button>
    </div>
  )
}
