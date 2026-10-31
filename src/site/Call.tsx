import { useEffect } from 'react'

import { formatPhone } from '../lib/time'

/**
 * Звонок из Mini App. В Telegram ссылка tel: не открывает звонилку, поэтому Mini App открывает эту
 * страницу через openLink — во встроенном браузере tel: работает. Номер — во фрагменте (#996…):
 * фрагмент не уходит на сервер и в логи nginx.
 */
export function Call() {
  const digits = window.location.hash.slice(1)
  const valid = /^\d{6,15}$/.test(digits)
  useEffect(() => {
    if (valid) window.location.href = `tel:+${digits}`
  }, [valid, digits])
  return (
    <main className="site-page site-message">
      {valid ? <a className="btn primary" href={`tel:+${digits}`}>Позвонить {formatPhone(digits)}</a> : <p>Номер не найден</p>}
    </main>
  )
}
