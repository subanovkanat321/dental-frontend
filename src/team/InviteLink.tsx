import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { botUsername } from '../api/client'
import { openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { inviteText } from './texts'

/**
 * Готовая ссылка-приглашение на бота: «join_<код>» врача или «staff_<код>» сотрудника. Человек
 * нажимает «Начать» — его Telegram привязывается сам. Отправить в WhatsApp (номер известен — сразу в его
 * чат, иначе WhatsApp спросит кому), в Telegram или скопировать.
 */
export function InviteLink({ start, name, toWhom, phone }: { start: string; name: string; toWhom: string; phone?: string | null }) {
  const bot = useQuery({ queryKey: ['bot-username'], queryFn: botUsername, staleTime: Infinity })
  const [copied, setCopied] = useState('')
  if (bot.isPending) return <p className="hint">Готовим ссылку…</p>
  if (!bot.data) return <p className="error">Бот не отвечает — попробуйте через минуту.</p>
  const link = `https://t.me/${bot.data}?start=${start}`
  const text = inviteText(name)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} ${link}`)
      setCopied('Скопировано — вставьте в WhatsApp или Telegram')
    } catch {
      setCopied('Не получилось скопировать — выделите ссылку выше')
    }
  }
  return (
    <div className="invite">
      <p className="hint">Ссылка работает один раз и 24 часа. Отправьте её {toWhom}:</p>
      <a className="invite-link" href={link} target="_blank" rel="noopener noreferrer">{link}</a>
      <div className="actions">
        <button type="button" className="btn" onClick={() => openLink(whatsappUrl(phone ?? '', `${text} ${link}`))}>Отправить в WhatsApp</button>
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать</button>
        <a className="btn" target="_blank" rel="noopener noreferrer"
          href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`}>Отправить в Telegram</a>
      </div>
      {copied && <p className="tone-ok" role="status">{copied}</p>}
    </div>
  )
}
