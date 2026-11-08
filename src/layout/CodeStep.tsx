import { useState } from 'react'

import { codeFromText } from '../lib/otp'

/**
 * Под полем кода: первые 60 секунд — только отсчёт, потом ссылка. SMS подключены — «Не пришло? Отправить по
 * SMS» (явно SMS, даже если номер привязан к Telegram); нет — «Отправить код ещё раз».
 */
export function ResendLink({ wait, sms, busy, onSms, onAgain }: {
  wait: number; sms: boolean; busy: boolean; onSms: () => void; onAgain: () => void
}) {
  if (wait > 0) {
    return <p className="hint small">{sms ? `Не пришло? Через ${wait} с можно отправить по SMS.` : `Отправить ещё раз — через ${wait} с.`}</p>
  }
  return sms
    ? <button type="button" className="link" disabled={busy} onClick={onSms}>Не пришло? Отправить по SMS</button>
    : <button type="button" className="link" disabled={busy} onClick={onAgain}>Отправить код ещё раз</button>
}

/** Буфер обмена можно прочитать (https, современный браузер); на iOS — только по нажатию. */
function canPaste(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
}

/**
 * Поле «Код подтверждения»: 6 цифр, автозаполнение из SMS (one-time-code). Код из Telegram копируют одним
 * нажатием — рядом кнопка «Вставить код»: буфер читаем только по её нажатию (никогда сами), и только где
 * браузер это умеет.
 */
export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [note, setNote] = useState('')
  const paste = async () => {
    try {
      const code = codeFromText(await navigator.clipboard.readText())
      if (code) {
        onChange(code)
        setNote('')
      } else {
        setNote('В буфере нет кода из 6 цифр — скопируйте его в Telegram или SMS')
      }
    } catch {
      setNote('Браузер не дал прочитать буфер — вставьте код в поле вручную')
    }
  }
  return (
    <>
      <label className="field"><span>Код подтверждения</span>
        <input value={value} autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoFocus
          placeholder="123456" onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onPaste={(e) => {
            const code = codeFromText(e.clipboardData.getData('text'))
            if (code) {
              e.preventDefault()
              onChange(code)
            }
          }} />
      </label>
      {canPaste() && <button type="button" className="link" onClick={() => void paste()}>Вставить код</button>}
      {note && <p className="hint small" role="status">{note}</p>}
    </>
  )
}
