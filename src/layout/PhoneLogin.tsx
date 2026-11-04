import { useEffect, useState } from 'react'

import { ApiError, phoneLogin, requestSmsCode } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'

/** Повторная отправка — не раньше, чем через минуту: так же считает сервер. */
export const RESEND_SECONDS = 60

/**
 * Вход без Telegram: номер → SMS-код → вход. Номер — тот, что администратор указал в «Персонале»
 * («Пригласить по номеру»). Сервер не говорит, есть ли такой номер: на любой номер ответ один, а SMS
 * приходит только сотруднику. Номер не сохраняем ни в адресе, ни в localStorage.
 */
export function PhoneLogin({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const explain = (e: unknown) => {
    if (!(e instanceof ApiError)) return 'Нет связи с сервером'
    if (e.status === 503) return 'Вход по SMS пока не подключён'
    return e.fieldErrors.phone ?? e.message
  }

  const getCode = async () => {
    setError('')
    setBusy(true)
    try {
      await requestSmsCode(phoneFromInput(phone))
      setSent(true)
      setCode('')
      setWait(RESEND_SECONDS)
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  const enter = async () => {
    setError('')
    setBusy(true)
    try {
      await phoneLogin(phoneFromInput(phone), code.trim())
      onDone()
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  if (!sent) {
    return (
      <form className="form phone-login" aria-label="Вход по номеру телефона" onSubmit={(e) => { e.preventDefault(); void getCode() }}>
        <label className="field"><span>Номер телефона</span>
          <PhoneInput label="Номер телефона" value={phone} onChange={setPhone} />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !phone.trim()}>{busy ? 'Отправляем…' : 'Получить код'}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    )
  }
  return (
    <form className="form phone-login" aria-label="Код из SMS" onSubmit={(e) => { e.preventDefault(); void enter() }}>
      <p className="hint">Если номер есть в персонале клиники, на него придёт SMS с кодом. Код действует 5 минут.</p>
      <label className="field"><span>Код из SMS</span>
        <input value={code} autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus
          placeholder="123456" onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Входим…' : 'Войти'}</button>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="link" disabled={wait > 0 || busy} onClick={() => void getCode()}>
          {wait > 0 ? `Отправить ещё раз через ${wait} с` : 'Отправить код ещё раз'}</button>
        <button type="button" className="link" onClick={() => { setSent(false); setError('') }}>Другой номер</button>
      </div>
    </form>
  )
}
