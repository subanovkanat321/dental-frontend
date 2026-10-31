import type { MouseEvent } from 'react'

import { formatPhone } from '../lib/time'
import { openLink, telegram } from '../lib/telegram'

/**
 * «Позвонить» и «WhatsApp» (пустой чат) — связаться с пациентом без готового текста: опаздывает,
 * не пришёл, рекомендации после приёма. В Telegram ссылка tel: не открывает звонилку — открываем
 * свою страницу звонка (call.html) его браузером; номер — во фрагменте #, на сервер он не уходит.
 */
export function ContactButtons({ phone, whatsapp = true }: { phone?: string | null; whatsapp?: boolean }) {
  if (!phone) return null
  const call = (e: MouseEvent) => {
    if (!telegram()) return
    e.preventDefault()
    openLink(`${window.location.origin}/call.html#${phone}`)
  }
  return (
    <div className="actions contact">
      <a className="btn" href={`tel:+${phone}`} onClick={call} aria-label={`Позвонить: ${formatPhone(phone)}`}>Позвонить</a>
      {whatsapp && <button type="button" className="btn" onClick={() => openLink(`https://wa.me/${phone}`)}>WhatsApp</button>}
    </div>
  )
}
