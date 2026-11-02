import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, type Schemas } from '../api/client'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { canPrint } from './paper'

type Message = Pick<Schemas['PatientMessage'], 'text' | 'telegram'>

/**
 * Две кнопки у каждого документа: «🖨 Печать» (в Telegram — подсказка «печать — с компьютера») и
 * «📤 Отправить пациенту». Пациент в Telegram — сообщение шлёт бот (сервер), иначе — WhatsApp с
 * готовым текстом: ссылку wa.me собирает браузер, на сервер телефон не уходит. Бот не доставил —
 * та же кнопка WhatsApp. Само ничего не отправляется — только по нажатию.
 *
 * @param message текст документа с сервера (для WhatsApp) и можно ли писать в бот; нет — ещё грузится
 * @param send отправить в бот (POST …/send)
 */
export function DocActions({ label, phone, message, send, onPrint }: {
  label: string
  phone?: string | null
  message?: Message
  send: () => Promise<unknown>
  onPrint: () => void
}) {
  const [sent, setSent] = useState(false)
  const bot = useMutation<unknown, ApiError>({
    mutationFn: send,
    onSuccess: () => {
      setSent(true)
      haptic('success')
    },
    onError: () => haptic('error'),
  })
  const whatsapp = () => {
    if (phone && message?.text) openLink(whatsappUrl(phone, message.text))
  }
  // Бот не смог (пациент удалил чат, бот выключен) — предложить WhatsApp
  const fallback = bot.error?.code === 'not-delivered' && phone && message?.text
  const ready = message != null
  const nowhere = ready && !message.telegram && !phone
  return (
    <div className="doc-actions">
      <div className="actions">
        {canPrint()
          ? <button type="button" className="btn" onClick={onPrint} aria-label={`Печать: ${label}`}>🖨 Печать</button>
          : <span className="hint small">🖨 Печать — с компьютера</span>}
        {message?.telegram ? (
          <button type="button" className="btn" disabled={bot.isPending} aria-label={`Отправить пациенту в Telegram: ${label}`}
            onClick={() => { setSent(false); bot.mutate() }}>📤 Отправить пациенту</button>
        ) : (
          <button type="button" className="btn" disabled={!ready || !phone} aria-label={`Отправить пациенту в WhatsApp: ${label}`}
            onClick={whatsapp}>📤 Отправить пациенту</button>
        )}
      </div>
      {nowhere && <p className="hint small">Пациент не в Telegram и без телефона — отправить некуда, распечатайте.</p>}
      {sent && <p className="tone-ok small" role="status">Отправлено в Telegram</p>}
      {bot.error && <p className="error small" role="alert">{bot.error.message}</p>}
      {fallback && <button type="button" className="btn small" onClick={whatsapp}>Отправить в WhatsApp</button>}
    </div>
  )
}
