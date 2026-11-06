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

/** Поле «Код подтверждения»: 6 цифр, автозаполнение из SMS. */
export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field"><span>Код подтверждения</span>
      <input value={value} autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoFocus
        placeholder="123456" onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
    </label>
  )
}
