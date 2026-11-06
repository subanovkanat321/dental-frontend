import { useEffect, useState } from 'react'

import { ApiError, passwordLogin, phoneLogin, requestSmsCode, setNewPassword } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { passwordProblem } from '../lib/password'
import { NewPasswordFields, PasswordInput, ShowPassword } from './PasswordFields'
import { Spinner } from './Loading'

/** Повторная отправка — не раньше, чем через минуту: так же считает сервер. */
export const RESEND_SECONDS = 60

type Step = 'password' | 'phone' | 'code' | 'new-password'

/**
 * Вход без Telegram по номеру, который администратор указал в «Персонале»:
 * <ul>
 * <li>обычно — «номер + пароль»;</li>
 * <li>первый вход или забыли пароль — номер → SMS-код → «Придумайте пароль» → вход;</li>
 * <li>временный пароль от админа — входит им и сразу придумывает свой.</li>
 * </ul>
 * Сервер не говорит, есть ли такой номер и задан ли пароль: на «неверный пароль» и «пароля нет» ответ
 * один — поэтому после ошибки предлагаем войти по SMS. Номер и пароль не сохраняем ни в адресе, ни в
 * localStorage.
 *
 * @param sms вход по SMS включён (провайдер подключён)
 * @param password вход по паролю включён
 */
export function PhoneLogin({ onDone, sms, password: byPassword = true }: { onDone: () => void; sms: boolean; password?: boolean }) {
  const [step, setStep] = useState<Step>(byPassword ? 'password' : 'phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [temporary, setTemporary] = useState(false)
  const [fresh, setFresh] = useState({ password: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // После неудачного входа по паролю — кнопка «Войти по SMS-коду»
  const [offerSms, setOfferSms] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const explain = (e: unknown) => {
    if (!(e instanceof ApiError)) return 'Нет связи с сервером'
    if (e.status === 503) return e.message || 'Вход по SMS пока не подключён'
    return e.fieldErrors.phone ?? e.fieldErrors.password ?? e.message
  }

  const go = (next: Step) => {
    setError('')
    setOfferSms(false)
    setStep(next)
  }

  const run = async (action: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (e) {
      setError(explain(e))
      return e
    } finally {
      setBusy(false)
    }
    return null
  }

  const getCode = () => run(async () => {
    await requestSmsCode(phoneFromInput(phone))
    setOfferSms(false)
    setStep('code')
    setCode('')
    setWait(RESEND_SECONDS)
  })

  const enterByPassword = async () => {
    setError('')
    setOfferSms(false)
    setBusy(true)
    try {
      const temp = await passwordLogin(phoneFromInput(phone), password)
      setBusy(false)
      if (!temp) {
        onDone()
        return
      }
      // Временный пароль от админа — сразу придумать свой
      setToken(temp.setupToken)
      setTemporary(true)
      setPassword('')
      setFresh({ password: '', repeat: '' })
      setStep('new-password')
    } catch (e) {
      setBusy(false)
      setError(explain(e))
      // 401 (нет номера, нет пароля, неверный) и 429 (блок) — предложить вход по SMS
      setOfferSms(e instanceof ApiError && (e.status === 401 || e.status === 429))
    }
  }

  const confirmCode = () => run(async () => {
    const t = await phoneLogin(phoneFromInput(phone), code.trim())
    setToken(t.setupToken)
    setTemporary(false)
    setFresh({ password: '', repeat: '' })
    setStep('new-password')
  })

  const savePassword = async () => {
    const problem = passwordProblem(fresh.password, fresh.repeat, phoneFromInput(phone))
    if (problem) {
      setError(problem)
      return
    }
    const failed = await run(() => setNewPassword(token, fresh.password))
    if (!failed) {
      onDone()
      return
    }
    // Пропуск устарел (10 минут) или уже использован — заново через SMS
    if (failed instanceof ApiError && failed.status === 401) {
      setToken('')
      setStep(sms ? 'phone' : 'password')
    }
  }

  if (step === 'password') {
    return (
      <form className="form phone-login" aria-label="Вход по номеру и паролю" onSubmit={(e) => { e.preventDefault(); void enterByPassword() }}>
        <label className="field"><span>Номер телефона</span>
          <PhoneInput label="Номер телефона" value={phone} onChange={setPhone} />
        </label>
        <PasswordInput label="Пароль" value={password} onChange={setPassword} shown={shown} autoComplete="current-password" />
        <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
        <button type="submit" className="btn primary" disabled={busy || !phone.trim() || !password}>{busy ? <><Spinner />Входим…</> : 'Войти'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        {offerSms && sms && (
          <button type="button" className="btn" disabled={busy} onClick={() => void getCode()}>Войти по SMS-коду</button>
        )}
        {sms ? (
          <button type="button" className="link" onClick={() => go('phone')}>Первый вход или забыли пароль? Войти по SMS</button>
        ) : (
          <p className="hint">Первый вход или забыли пароль? Попросите администратора клиники задать временный пароль
            («Настройки → Персонал»): вход по SMS пока не подключён.</p>
        )}
      </form>
    )
  }

  if (step === 'phone') {
    return (
      <form className="form phone-login" aria-label="Вход по SMS-коду" onSubmit={(e) => { e.preventDefault(); void getCode() }}>
        <p className="hint">Пришлём код в SMS, потом придумаете пароль — дальше входите номером и паролем.</p>
        <label className="field"><span>Номер телефона</span>
          <PhoneInput label="Номер телефона" value={phone} onChange={setPhone} />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !phone.trim()}>{busy ? <><Spinner />Отправляем…</> : 'Получить код'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        {byPassword && <button type="button" className="link" onClick={() => go('password')}>Войти по паролю</button>}
      </form>
    )
  }

  if (step === 'code') {
    return (
      <form className="form phone-login" aria-label="Код из SMS" onSubmit={(e) => { e.preventDefault(); void confirmCode() }}>
        <p className="hint">Если номер есть в персонале клиники, на него придёт SMS с кодом. Код действует 5 минут.</p>
        <label className="field"><span>Код из SMS</span>
          <input value={code} autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus
            placeholder="123456" onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? <><Spinner />Проверяем…</> : 'Дальше'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="link" disabled={wait > 0 || busy} onClick={() => void getCode()}>
            {wait > 0 ? `Отправить ещё раз через ${wait} с` : 'Отправить код ещё раз'}</button>
          <button type="button" className="link" onClick={() => go('phone')}>Другой номер</button>
        </div>
      </form>
    )
  }

  return (
    <form className="form phone-login" aria-label="Придумайте пароль" onSubmit={(e) => { e.preventDefault(); void savePassword() }}>
      <h2>Придумайте пароль</h2>
      <p className="hint">{temporary
        ? 'Временный пароль подошёл. Придумайте свой — дальше входите номером и им.'
        : 'Номер подтверждён. Дальше входите номером и этим паролем.'}</p>
      <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone={phoneFromInput(phone)}
        onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
      <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner />Сохраняем…</> : 'Сохранить и войти'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}
