import { useState } from 'react'

import { ApiError, passwordLogin, phoneLogin, requestLoginCode, setNewPassword, type CodeChannel } from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { CodeInput, ResendLink } from './CodeStep'
import { sentText, useCountdown } from '../lib/otp'
import { NewPasswordFields, PasswordInput, ShowPassword } from './PasswordFields'
import { passwordProblem } from '../lib/password'
import { Spinner } from './Loading'

/** Кнопка с пароля на восстановление: и первый пароль, и «забыли» — один и тот же путь. */
export const FORGOT = 'Забыли пароль? / Первый вход'

type Step = 'password' | 'phone' | 'code' | 'new-password'

/**
 * Вход на сайт — по номеру телефона и паролю (кнопки «Войти через Telegram» больше нет):
 * <ul>
 * <li>обычно — «номер + пароль»;</li>
 * <li>первый вход или забыли пароль — номер → «Получить код» → код → «Подтвердить» → только потом
 * «Придумайте пароль» → вход. Канал выбирает сервер: Telegram (бот сотрудников, бесплатно), если номер к
 * нему привязан и бот доставил, иначе SMS — чтобы не тратить лимит SMS;</li>
 * <li>временный пароль от админа — входит им и сразу придумывает свой.</li>
 * </ul>
 * Сервер не говорит, есть ли такой номер, задан ли пароль и куда ушёл код: ответ на «Получить код» всегда
 * один. Поэтому под кодом — оба варианта («в Telegram, если номер привязан, иначе SMS»), а через 60 секунд —
 * «Не пришло? Отправить по SMS». Номер и пароль не сохраняем ни в адресе, ни в localStorage.
 *
 * @param sms коды по SMS подключены
 * @param telegram код в Telegram включён (бот настроен)
 * @param password вход по паролю включён
 */
export function PhoneLogin({ onDone, sms, telegram = true, password: byPassword = true }:
  { onDone: () => void; sms: boolean; telegram?: boolean; password?: boolean }) {
  const [step, setStep] = useState<Step>(byPassword ? 'password' : 'phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [code, setCode] = useState('')
  const [channel, setChannel] = useState<CodeChannel>('auto')
  const [token, setToken] = useState('')
  const [temporary, setTemporary] = useState(false)
  const [fresh, setFresh] = useState({ password: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wait, restart] = useCountdown()
  const canRecover = telegram || sms

  const explain = (e: unknown) => {
    if (!(e instanceof ApiError)) return 'Нет связи с сервером'
    if (e.status === 503) return e.message || 'Коды по SMS пока не подключены'
    return e.fieldErrors.phone ?? e.fieldErrors.password ?? e.message
  }

  const go = (next: Step) => {
    setError('')
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

  const getCode = (via: CodeChannel) => run(async () => {
    await requestLoginCode(phoneFromInput(phone), via)
    setChannel(via)
    setStep('code')
    setCode('')
    restart()
  })

  const enterByPassword = async () => {
    setError('')
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
    // Пропуск устарел (10 минут) или уже использован — заново через код
    if (failed instanceof ApiError && failed.status === 401) {
      setToken('')
      setStep(canRecover ? 'phone' : 'password')
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
        {canRecover ? (
          <>
            <button type="button" className={error ? 'btn' : 'link'} onClick={() => go('phone')}>{FORGOT}</button>
            {telegram && <p className="hint">Нет пароля? Нажмите «{FORGOT}» — пришлём код {sms ? 'в Telegram или по SMS' : 'в Telegram'}.</p>}
          </>
        ) : (
          <p className="hint">Первый вход или забыли пароль? Попросите администратора клиники задать временный пароль
            («Настройки → Персонал»).</p>
        )}
      </form>
    )
  }

  if (step === 'phone') {
    return (
      <form className="form phone-login" aria-label="Код для входа" onSubmit={(e) => { e.preventDefault(); void getCode('auto') }}>
        <h2>Первый вход или новый пароль</h2>
        <p className="hint">Пришлём код, вы его подтвердите — и потом придумаете пароль. Дальше входите номером и паролем.</p>
        <label className="field"><span>Номер телефона</span>
          <PhoneInput label="Номер телефона" value={phone} onChange={setPhone} />
        </label>
        {canRecover && (
          <button type="submit" className="btn primary" disabled={busy || !phone.trim()}>
            {busy ? <><Spinner />Отправляем…</> : 'Получить код'}</button>
        )}
        {telegram && (
          <p className="hint small">Код бесплатно придёт в Telegram от бота клиники, если номер привязан к вашему Telegram
            (в боте: «📱&nbsp;Поделиться номером»){sms ? ', иначе — SMS на этот номер.' : '.'}</p>
        )}
        {!canRecover && <p className="hint">Коды сейчас не отправляются — попросите администратора задать временный пароль.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {byPassword && <button type="button" className="link" onClick={() => go('password')}>Назад: вход по паролю</button>}
      </form>
    )
  }

  if (step === 'code') {
    return (
      <form className="form phone-login" aria-label="Код подтверждения" onSubmit={(e) => { e.preventDefault(); void confirmCode() }}>
        <p className="hint" role="status">{sentText(channel === 'sms', telegram, sms)} Код действует 5 минут.</p>
        <CodeInput value={code} onChange={setCode} />
        <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? <><Spinner />Проверяем…</> : 'Подтвердить'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <ResendLink wait={wait} sms={sms} busy={busy} onSms={() => void getCode('sms')} onAgain={() => void getCode('auto')} />
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
