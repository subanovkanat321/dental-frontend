import { usePlatformInfo } from '../api/platform'
import { formatPhone } from '../lib/time'

/** Связаться с разработчиками: Telegram, телефон, почта — что задано в «Сведениях о платформе». */
export function DeveloperContacts() {
  const info = usePlatformInfo().data
  if (!info?.supportUrl && !info?.supportPhone && !info?.supportEmail) {
    return <p className="hint">Контакты разработчиков пока не заданы.</p>
  }
  return (
    <div className="actions">
      {info.supportUrl && <a className="btn primary" href={info.supportUrl} target="_blank" rel="noopener noreferrer">Разработчикам в Telegram</a>}
      {info.supportPhone && <a className="btn" href={`tel:+${info.supportPhone.replace(/\D/g, '')}`}>Позвонить: {formatPhone(info.supportPhone.replace(/\D/g, ''))}</a>}
      {info.supportEmail && <a className="btn" href={`mailto:${info.supportEmail}`}>Написать на почту</a>}
    </div>
  )
}
