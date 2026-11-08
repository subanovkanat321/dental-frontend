import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { botUsername } from '../api/client'
import { openLink, telegram } from '../lib/telegram'
import { smsUrl, whatsappUrl } from '../lib/texts'
import { inviteText, siteInviteText } from './texts'
import { Loading } from '../layout/Loading'

/** Врача и сотрудника клиники зовём ссылкой на сайт; менеджера платформы («mgr_») — только ботом. */
function siteInvite(start: string): boolean {
  return /^(join|staff)_/.test(start)
}

/**
 * Готовая ссылка-приглашение. Врачу («join_<код>») и сотруднику («staff_<код>») — на сайт:
 * {@code /invite#<старт>} (код во фрагменте — не уходит на сервер и в журнал nginx). Там человек выбирает:
 * «Открыть в Telegram» (тот же старт у бота — «Начать», и Telegram привязан) или регистрация по номеру
 * телефона без Telegram. Менеджеру платформы («mgr_») — как раньше, сразу на бота. Отправить в WhatsApp (номер известен — сразу в его
 * чат, иначе WhatsApp спросит кому), в Telegram или скопировать. sms — ещё и SMS (владелец платформы
 * приглашает клинику без WhatsApp и Telegram: SMS уходит с SIM-карты его телефона).
 */
export function InviteLink({ start, name, toWhom, phone, sms = false }: { start: string; name: string; toWhom: string; phone?: string | null; sms?: boolean }) {
  const site = siteInvite(start)
  const bot = useQuery({ queryKey: ['bot-username'], queryFn: botUsername, staleTime: Infinity, enabled: !site })
  const [copied, setCopied] = useState('')
  if (!site && bot.isPending) return <Loading text="Готовим ссылку…" />
  if (!site && !bot.data) return <p className="error">Бот не отвечает — попробуйте через минуту.</p>
  const link = site ? `${window.location.origin}/invite#${start}` : `https://t.me/${bot.data}?start=${start}`
  const text = site ? siteInviteText(name) : inviteText(name)
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
      <p className="hint">Ссылка работает один раз и 24 часа. Отправьте её {toWhom}{site ? ' — войдёт через Telegram или по номеру телефона, если Telegram нет' : ''}:</p>
      <a className="invite-link" href={link} target="_blank" rel="noopener noreferrer">{link}</a>
      <div className="actions">
        <button type="button" className="btn" onClick={() => openLink(whatsappUrl(phone ?? '', `${text} ${link}`))}>Отправить в WhatsApp</button>
        {/* Ссылкой, а не из скрипта: встроенный браузер Telegram так надёжнее открывает «Сообщения» */}
        {sms && <a className="btn" href={smsUrl(phone ?? '', `${text} ${link}`)} onClick={(e) => {
          // В Telegram ссылка sms: молчит — открываем свою страницу браузером телефона, она откроет «Сообщения»
          if (!telegram()) return
          e.preventDefault()
          openLink(`${window.location.origin}/call.html#${new URLSearchParams({ sms: phone ?? '', body: `${text} ${link}` })}`)
        }}>Отправить SMS</a>}
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать</button>
        <a className="btn" target="_blank" rel="noopener noreferrer"
          href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`}>Отправить в Telegram</a>
      </div>
      {copied && <p className="tone-ok" role="status">{copied}</p>}
    </div>
  )
}
