import { inTelegram } from './telegram'
import { formatPhone } from './time'

export type ContactTexts = { call: string; whatsapp: string }

const RU: ContactTexts = { call: 'Позвонить', whatsapp: 'Написать в WhatsApp' }

/**
 * Связаться: «Позвонить» на каждый номер (номер в подписи — понятно, куда звонишь) и WhatsApp —
 * только если номер WhatsApp есть: у многих он другой, а без него кнопка вела бы в никуда.
 * Одно место для страниц сайта, Mini App и CRM. className={null} — без своей обёртки: кнопки встают в
 * ряд соседних (Telegram, почта).
 */
export function ContactLinks({ phones, whatsapp, waText, texts = RU, className = 'actions' }: {
  phones?: string[] | null; whatsapp?: string | null; waText?: string; texts?: ContactTexts; className?: string | null
}) {
  const list = phones ?? []
  if (!list.length && !whatsapp) return null
  const wa = whatsapp && `https://wa.me/${whatsapp}${waText ? `?text=${encodeURIComponent(waText)}` : ''}`
  const links = (
    <>
      {wa && <a className="btn" data-tone="wa" href={wa} target="_blank" rel="noopener noreferrer" onClick={inTelegram(wa)}>{texts.whatsapp}</a>}
      {list.map((p) => (
        <a key={p} className="btn" href={`tel:+${p}`} onClick={inTelegram(`tel:+${p}`)}>
          {texts.call} <span className="num nowrap">{formatPhone(p)}</span></a>
      ))}
    </>
  )
  return className === null ? links : <div className={className}>{links}</div>
}
