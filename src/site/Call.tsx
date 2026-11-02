import { useEffect } from 'react'

import { formatPhone } from '../lib/time'

/**
 * Звонок и SMS из Mini App. В Telegram ссылки tel: и sms: не открывают звонилку и «Сообщения», поэтому
 * Mini App открывает эту страницу через openLink — в браузере телефона они работают. Номер и текст —
 * во фрагменте (#996… или #sms=996…&body=…): фрагмент не уходит на сервер и в логи nginx.
 */
export function Call() {
  const hash = window.location.hash.slice(1)
  const sms = hash.startsWith('sms=') ? new URLSearchParams(hash) : null
  const digits = sms ? sms.get('sms') ?? '' : hash
  const valid = /^\d{6,15}$/.test(digits) || (sms != null && digits === '')
  const href = sms ? `sms:${digits ? `+${digits}` : ''}?&body=${encodeURIComponent(sms.get('body') ?? '')}` : `tel:+${digits}`
  useEffect(() => {
    if (valid) window.location.href = href
  }, [valid, href])
  return (
    <main className="site-page site-message">
      {!valid ? <p>Номер не найден</p>
        : sms ? <a className="btn primary" href={href}>Отправить SMS{digits ? ` на ${formatPhone(digits)}` : ''}</a>
          : <a className="btn primary" href={href}>Позвонить {formatPhone(digits)}</a>}
    </main>
  )
}
