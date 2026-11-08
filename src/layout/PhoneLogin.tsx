import { useEffect, useState } from 'react'

import {
  ApiError, forgetLoginPending, loginPending, passwordLogin, phoneLogin, requestLoginCode, setNewPassword, type CodeChannel,
} from '../api/client'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput } from '../clinic/phone'
import { CodeInput, ResendLink } from './CodeStep'
import { sentText, useCountdown } from '../lib/otp'
import { NewPasswordFields, PasswordInput, ShowPassword } from './PasswordFields'
import { passwordProblem } from '../lib/password'
import { Spinner } from './Loading'

/** Кнопка с пароля на восстановление: и первый пароль, и «забыли» — один и тот же путь. */
export const FORGOT = 'Забыли пароль? / Первый вход'

type Step = 'checking' | 'password' | 'phone' | 'code' | 'new-password'

/** Ответ сервера, когда cookie «ждём код» истекла: тогда — снова номер. */
const CODE_EXPIRED = 'Время на ввод кода вышло'

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
 * <p>
 * Шаг переживает перезагрузку (iOS выгружает вкладку или PWA, пока человек копирует код в Telegram): при
 * открытии спрашиваем сервер ({@link loginPending}) — он помнит шаг в HttpOnly-cookie и отдаёт номер только
 * маской. Тогда номера на странице нет: код, повтор и пароль уходят без него, сервер подставит свой.
 *
 * @param sms коды по SMS подключены
 * @param telegram код в Telegram включён (бот настроен)
 * @param password вход по паролю включён
 */
export function PhoneLogin({ onDone, sms, telegram = true, password: byPassword = true }:
  { onDone: () => void; sms: boolean; telegram?: boolean; password?: boolean }) {
  const first: Step = byPassword ? 'password' : 'phone'
  const [step, setStep] = useState<Step>('checking')
  const [phone, setPhone] = useState('')
  /** Номер маской от сервера — после перезагрузки; набранного номера тогда нет. */
  const [masked, setMasked] = useState('')
  const [minutesLeft, setMinutesLeft] = useState(5)
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

  useEffect(() => {
    let alive = true
    void loginPending().then((p) => {
      if (!alive) return
      if (p?.step === 'code') {
        setMasked(p.phoneMasked)
        setMinutesLeft(Math.max(1, Math.ceil(p.secondsLeft / 60)))
        restart(p.resendSeconds)
        setStep('code')
      } else if (p?.step === 'password') {
        setMasked(p.phoneMasked)
        setTemporary(p.temporary)
        setStep('new-password')
      } else {
        setStep(first)
      }
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии экрана входа
  }, [])

  /** Номер для запроса: набранный; после перезагрузки его нет — пусто, сервер возьмёт свой из cookie. */
  const typed = () => (phone.trim() ? phoneFromInput(phone) : '')

  const explain = (e: unknown) => {
    if (!(e instanceof ApiError) || e.status === 0) return 'Нет связи с сервером'
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
    await requestLoginCode(typed(), via)
    setChannel(via)
    setStep('code')
    setCode('')
    setMinutesLeft(5)
    restart()
  })

  /** «Другой номер»: забыть шаг и на сервере (cookie), чтобы перезагрузка не вернула старый номер. */
  const anotherNumber = () => {
    void forgetLoginPending().catch(() => undefined)
    setMasked('')
    setCode('')
    go('phone')
  }

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

  const confirmCode = async () => {
    const failed = await run(async () => {
      const t = await phoneLogin(typed(), code.trim())
      setToken(t.setupToken)
      setTemporary(false)
      setFresh({ password: '', repeat: '' })
      setStep('new-password')
    })
    // Код после перезагрузки, а время вышло — снова номер (сообщение сервера остаётся)
    if (failed instanceof ApiError && failed.status === 401 && failed.message.startsWith(CODE_EXPIRED)) {
      setMasked('')
      setStep('phone')
    }
  }

  const savePassword = async () => {
    const problem = passwordProblem(fresh.password, fresh.repeat, typed())
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
      setMasked('')
      setStep(canRecover ? 'phone' : 'password')
    }
  }

  if (step === 'checking') {
    return <p className="hint phone-login" role="status"><Spinner />Загружаем…</p>
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
          <p className="hint">Первый вход или забыли пароль? Попросите руководителя клиники задать временный пароль
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
        {!canRecover && <p className="hint">Коды сейчас не отправляются — попросите руководителя задать временный пароль.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {byPassword && <button type="button" className="link" onClick={() => go('password')}>Назад: вход по паролю</button>}
      </form>
    )
  }

  if (step === 'code') {
    return (
      <form className="form phone-login" aria-label="Код подтверждения" onSubmit={(e) => { e.preventDefault(); void confirmCode() }}>
        <p className="hint" role="status">{masked && <>Код отправлен на <b>{masked}</b>. </>}
          {sentText(channel === 'sms', telegram, sms)} Код действует {masked ? `ещё ${minutesLeft} мин.` : '5 минут.'}</p>
        <CodeInput value={code} onChange={setCode} />
        <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? <><Spinner />Проверяем…</> : 'Подтвердить'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <ResendLink wait={wait} sms={sms} busy={busy} onSms={() => void getCode('sms')} onAgain={() => void getCode('auto')} />
          <button type="button" className="link" onClick={anotherNumber}>Другой номер</button>
        </div>
        {/* Сервер не скажет, что номера нет (по ответу не узнать чужой номер), — частая причина «не пришло»:
            сотрудник работает через Telegram, а номер для входа ещё не привязал */}
        {telegram && wait === 0 && (
          <p className="hint small">Не приходит код? Если вы работаете в Tish через Telegram, сначала привяжите номер: в боте
            нажмите «📱&nbsp;Поделиться номером» или в приложении — «Настройки → Изменить профиль → Телефон».</p>
        )}
      </form>
    )
  }

  return (
    <form className="form phone-login" aria-label="Придумайте пароль" onSubmit={(e) => { e.preventDefault(); void savePassword() }}>
      <h2>Придумайте пароль</h2>
      <p className="hint">{temporary
        ? 'Временный пароль подошёл. Придумайте свой — дальше входите номером и им.'
        : `Номер${masked ? ` ${masked}` : ''} подтверждён. Дальше входите номером и этим паролем.`}</p>
      <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone={typed()}
        onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
      <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner />Сохраняем…</> : 'Сохранить и войти'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}
