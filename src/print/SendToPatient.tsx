import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, type Schemas } from '../api/client'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { DocPreview, type Paper } from './DocPreview'
import type { PaperFormat } from './paper'

type Message = Pick<Schemas['PatientMessage'], 'text' | 'telegram'>

/**
 * Документ пациенту (памятка, квитанция, план без цен): одна кнопка «👁 Просмотр» — под ней ровно то, что он получит
 * (сообщение с сервера и лист печати, DocPreview), и уже оттуда «Отправить в Telegram / WhatsApp» или «🖨 Печать».
 * Пациент в Telegram — сообщение шлёт бот (сервер), иначе — WhatsApp с готовым текстом: ссылку wa.me собирает браузер,
 * на сервер телефон не уходит. Бот не доставил — кнопка WhatsApp. Само ничего не отправляется — только по нажатию.
 *
 * @param message текст документа с сервера (для WhatsApp и просмотра) и можно ли писать в бот; нет — ещё грузится
 * @param send отправить в бот (POST …/send)
 * @param paper лист печати для вкладки «📄 Лист»; нет — «🖨 Печать» сразу открывает окно печати
 * @param onPrint открыть окно печати (в выбранном в просмотре формате)
 */
export function DocActions({ label, phone, message, send, onPrint, paper }: {
  label: string
  phone?: string | null
  message?: Message
  send: () => Promise<unknown>
  onPrint: (format: PaperFormat) => void
  paper?: Paper
}) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState('')
  const bot = useMutation<unknown, ApiError>({
    mutationFn: send,
    onSuccess: () => {
      setSent('Отправлено в Telegram')
      haptic('success')
    },
    onError: () => haptic('error'),
  })
  const whatsapp = () => {
    if (phone && message?.text) {
      openLink(whatsappUrl(phone, message.text))
      setSent('Открыли WhatsApp с этим текстом — нажмите там «Отправить»')
    }
  }
  // Бот не смог (пациент удалил чат, бот выключен) — предложить WhatsApp
  const fallback = bot.error?.code === 'not-delivered' && phone && message?.text
  return (
    <div className="doc-actions">
      {!open && (
        <div className="actions">
          <button type="button" className="btn" disabled={message == null} aria-label={`Просмотр: ${label}`}
            onClick={() => { setSent(''); bot.reset(); setOpen(true) }}>👁 Просмотр</button>
        </div>
      )}
      {open && message && (
        <DocPreview label={label} text={message.text ?? ''} telegram={Boolean(message.telegram)} phone={phone} paper={paper}
          busy={bot.isPending} onClose={() => setOpen(false)} onPrint={onPrint}
          sendLabel={(c) => `Отправить пациенту в ${c === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'}: ${label}`}
          onTelegram={() => { setSent(''); bot.mutate() }} onWhatsapp={whatsapp}>
          {sent && <p className="tone-ok small" role="status">{sent}</p>}
          {bot.error && <p className="error small" role="alert">{bot.error.message}</p>}
          {fallback && <button type="button" className="btn small" onClick={whatsapp}>Отправить в WhatsApp</button>}
        </DocPreview>
      )}
    </div>
  )
}
