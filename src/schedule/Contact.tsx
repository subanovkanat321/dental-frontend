import { inTelegram, openLink } from '../lib/telegram'
import { formatPhone } from '../lib/time'

/**
 * «Позвонить» и «WhatsApp» (пустой чат) — связаться с пациентом без готового текста: опаздывает,
 * не пришёл, рекомендации после приёма. В Telegram ссылка tel: не открывает звонилку — inTelegram
 * открывает свою страницу звонка (call.html) браузером; номер — во фрагменте #, на сервер он не уходит.
 */
export function ContactButtons({ phone, whatsapp = true }: { phone?: string | null; whatsapp?: boolean }) {
  if (!phone) return null
  return (
    <div className="actions contact">
      <a className="btn" href={`tel:+${phone}`} onClick={inTelegram(`tel:+${phone}`)} aria-label={`Позвонить: ${formatPhone(phone)}`}>Позвонить</a>
      {whatsapp && <button type="button" className="btn" onClick={() => openLink(`https://wa.me/${phone}`)}>WhatsApp</button>}
    </div>
  )
}
