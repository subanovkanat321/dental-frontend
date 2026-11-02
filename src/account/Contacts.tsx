import { usePlatformInfo } from '../api/platform'
import { ContactLinks } from '../lib/ContactLinks'

/** Связаться с разработчиками: Telegram, телефоны, WhatsApp (если задан), почта — из «Сведений о платформе». */
export function DeveloperContacts() {
  const info = usePlatformInfo().data
  if (!info?.supportUrl && !info?.supportPhones?.length && !info?.supportWhatsapp && !info?.supportEmail) {
    return <p className="hint">Контакты разработчиков пока не заданы.</p>
  }
  return (
    <div className="actions">
      {info.supportUrl && <a className="btn primary" href={info.supportUrl} target="_blank" rel="noopener noreferrer">Разработчикам в Telegram</a>}
      <ContactLinks className={null} phones={info.supportPhones} whatsapp={info.supportWhatsapp} />
      {info.supportEmail && <a className="btn" href={`mailto:${info.supportEmail}`}>Написать на почту</a>}
    </div>
  )
}
