import { useState } from 'react'

import { PhoneInput } from './PhoneInput'

/**
 * Номер записи справочника (поставщик, лаборатория): одно поле «Телефон / WhatsApp» — у большинства это один номер.
 * WhatsApp на другом номере — по ссылке «＋ WhatsApp на другом номере» второе поле; у записи, где он уже свой,
 * второе поле открыто сразу. Пустой WhatsApp значит «тот же, что телефон» — так его понимает и сервер.
 */
export function PhoneWhatsappFields({ phone, whatsapp, onPhone, onWhatsapp, phoneError, whatsappError }: {
  phone: string
  whatsapp: string
  onPhone: (v: string) => void
  onWhatsapp: (v: string) => void
  phoneError?: string
  whatsappError?: string
}) {
  // Открыто, если номер уже есть (запись со своим WhatsApp) или сервер ругается на него
  const [open, setOpen] = useState(() => Boolean(whatsapp))
  const shown = open || Boolean(whatsappError)
  return (
    <>
      <label className="field"><span>Телефон / WhatsApp <span className="hint">— необязательно</span></span>
        <PhoneInput label="Телефон / WhatsApp" value={phone} onChange={onPhone} /></label>
      {phoneError && <p className="error">{phoneError}</p>}
      {shown ? (
        <>
          <label className="field"><span>WhatsApp <span className="hint">— если на другом номере</span></span>
            <PhoneInput label="WhatsApp" value={whatsapp} onChange={onWhatsapp} /></label>
          {whatsappError && <p className="error">{whatsappError}</p>}
        </>
      ) : (
        <button type="button" className="link" onClick={() => setOpen(true)}>＋ WhatsApp на другом номере</button>
      )}
    </>
  )
}

