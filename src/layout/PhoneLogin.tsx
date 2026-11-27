import { useEffect, useState } from 'react'

import {
  ApiError, forgetLoginPending, loginPending, passwordLogin, phoneLogin, requestLoginCode, setNewPassword,
  type CodeChannel,
} from '../api/client'
import { phoneFromInput, phoneFromText } from '../clinic/phone'
import { phoneText } from '../team/texts'
import { CodeInput, ResendLink } from './CodeStep'
import { SENT_TELEGRAM, useCountdown } from '../lib/otp'
import { NewPasswordFields, PasswordInput, ShowPassword } from './PasswordFields'
import { passwordProblem } from '../lib/password'
import { isUsername } from '../lib/username'
import { Spinner } from './Loading'

/** Кнопка с пароля на восстановление: и первый пароль, и «забыли» — один и тот же путь. */
export const FORGOT = 'Забыли пароль? / Первый вход'

type Step = 'checking' | 'password' | 'phone' | 'channel' | 'code' | 'new-password'

/** Подпись поля входа: логин (V264 бэкенда) или номер в любом виде. */
export const LOGIN_LABEL = 'Логин или телефон'

/** Поле «Забыли пароль?», когда на сервере настроена почта: можно вписать и её — код сразу придёт письмом. */
export const RECOVER_LABEL = 'Логин, телефон или почта'

/** «А если почта не указана?» — на шаге выбора канала и кода на почту. */
export const NO_MAIL = 'Почту не добавляли? Код придёт в Telegram, если номер привязан к боту. Нет ни почты, ни Telegram — попросите руководителя выдать временный пароль («Клиника → Персонал»).'

/** То же после кода на введённую почту: номера на странице нет — его надо вписать. */
export const NO_MAIL_BY_EMAIL = 'Почту не добавляли? Впишите логин или номер — код придёт в Telegram, если номер привязан к боту. Нет ни почты, ни Telegram — попросите руководителя выдать временный пароль («Клиника → Персонал»).'

/** Что вписали в «Логин, телефон или почта» — так же решает сервер (PhoneLoginController.keyOf). */
type Entered = 'phone' | 'login' | 'email'

function enteredOf(text: string): Entered {
  return text.includes('@') ? 'email' : isUsername(text) ? 'login' : 'phone'
}

/** Почта не настроена на сервере: код только в Telegram — куда идти, если Telegram нет или номер не привязан. */
export const TELEGRAM_ONLY = 'Код приходит в Telegram — от бота клиники, если номер привязан к вашему Telegram (в боте: «📱\u00a0Поделиться номером»). Нет Telegram — попросите руководителя клиники выдать временный пароль («Клиника → Персонал»).'

/** 503 без текста от сервера. */
const NO_CODE = 'Код сейчас не отправить — попросите руководителя клиники выдать временный пароль'

/** Ответ сервера, когда cookie «ждём код» истекла: тогда — снова номер. */
const CODE_EXPIRED = 'Время на ввод кода вышло'

/**
 * Вход на сайт — по логину или номеру телефона и паролю (решение владельца 2026-11-27: на странице входа только
 * «Войти через Telegram» и эта форма; SMS-коды убраны):
 * <ul>
 * <li>обычно — «логин или телефон» + пароль: одно поле, сервер сам поймёт (есть латинская буква — логин);</li>
 * <li>первый вход или забыли пароль — «Забыли пароль? / Первый вход» → логин или номер (почта настроена — «логин,
 * телефон или почта») → код → «Подтвердить» → только потом «Придумайте пароль» → вход. Код — в Telegram (бот
 * сотрудников, если номер к нему привязан) или на почту из «Моего профиля» ({@code mail}: после номера — выбор «В
 * Telegram» / «На почту»; вписали почту — сразу письмо). Адреса почты (даже маской) не показываем: он выдал бы, что у
 * номера есть почта, а значит и сам номер;</li>
 * <li>временный пароль от админа — входит им и сразу придумывает свой.</li>
 * </ul>
 * Сервер не говорит, есть ли такой номер, задан ли пароль и куда ушёл код: ответ на «Получить код» всегда один.
 * Логин, номер и пароль не сохраняем ни в адресе, ни в localStorage.
 * <p>
 * Шаг переживает перезагрузку (iOS выгружает вкладку или PWA, пока человек копирует код в Telegram): при
 * открытии спрашиваем сервер ({@link loginPending}) — он помнит шаг в HttpOnly-cookie и отдаёт номер только
 * маской. Тогда номера на странице нет: код, повтор и пароль уходят без него, сервер подставит свой.
 *
 * @param telegram код в Telegram включён (бот настроен)
 * @param password вход по паролю включён
 * @param mail код можно получить на почту (MAIL_* на сервере настроены)
 * @param secondary над формой — главный «Войти через Telegram»
 */
export function PhoneLogin({ onDone, telegram = true, password: byPassword = true, mail = false, secondary = false }:
  { onDone: () => void; telegram?: boolean; password?: boolean; mail?: boolean
    /** Над формой — «Войти через Telegram»: он главный, кнопка «Войти» здесь не яркая */
    secondary?: boolean }) {
  const first: Step = byPassword ? 'password' : 'phone'
  const [step, setStep] = useState<Step>('checking')
  /** «Логин, телефон или почта» для «Забыли пароль?» — своим полем (на шаге пароля — login). */
  const [phone, setPhone] = useState('')
  /** Куда ушёл код: что вписали (или что помнит сервер после перезагрузки) — от этого тексты шага кода. */
  const [sentTo, setSentTo] = useState<Entered>('phone')
  /** «Логин или телефон» на шаге пароля. */
  const [login, setLogin] = useState('')
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
  const canRecover = telegram || mail

  useEffect(() => {
    let alive = true
    void loginPending().then((p) => {
      if (!alive) return
      if (p?.step === 'code') {
        setMasked(p.phoneMasked)
        setSentTo(p.entered ?? 'phone')
        if (p.mail) setChannel('mail')
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

  const entered = enteredOf(phone)
  /**
   * Логин, номер или почта для запроса: логин и почта — как есть, номер — в виде для запроса; после перезагрузки поля нет —
   * пусто, сервер возьмёт своё из cookie.
   */
  const typed = () => (!phone.trim() ? '' : entered === 'phone' ? phoneFromInput(phone) : phone.trim())
  /** Поле входа для запроса: логин как есть, номер — как из поля телефона («555 123 456» → «+996555123456»). */
  const loginValue = () => (isUsername(login) ? login.trim() : phoneFromInput(login))
  /** Номер для подсказок «пароль не номер»: из поля восстановления или из поля входа, если там номер. */
  const knownPhone = () => (phone.trim() && entered === 'phone' ? phoneFromInput(phone) : '')
    || (login.trim() && !isUsername(login) ? phoneFromInput(login) : '')
  /** Логин для подсказок «пароль не логин»: из поля восстановления или из поля входа. */
  const knownLogin = () => (phone.trim() && entered === 'login' ? phone.trim() : isUsername(login) && !login.includes('@') ? login.trim() : '')

  const explain = (e: unknown) => {
    if (!(e instanceof ApiError) || e.status === 0) return 'Нет связи с сервером'
    if (e.status === 503) return e.message || NO_CODE
    return e.fieldErrors.login ?? e.fieldErrors.phone ?? e.fieldErrors.password ?? e.message
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
    if (phone.trim()) setSentTo(entered)
    setChannel(via)
    setStep('code')
    setCode('')
    setMinutesLeft(via === 'mail' ? 10 : 5)
    restart()
  })

  /**
   * После поля: вписали почту — сразу письмо (выбирать нечего); логин или номер и почта настроена — выбор канала, иначе
   * сразу «Получить код», как раньше. Почта не настроена, а вписали почту — подсказка без слова «почта».
   */
  const next = () => {
    if (entered === 'email') {
      if (mail) return getCode('mail')
      setError('Введите логин или номер телефона')
      return
    }
    return mail ? go('channel') : getCode('auto')
  }

  /** «Другой номер»: забыть шаг и на сервере (cookie), чтобы перезагрузка не вернула старый номер. */
  const anotherNumber = () => {
    void forgetLoginPending().catch(() => undefined)
    setMasked('')
    setCode('')
    setSentTo('phone')
    go('phone')
  }

  /** «Другой номер» — по тому, что вписали: почту или логин тоже можно поменять. */
  const anotherLabel = sentTo === 'email' ? 'Другая почта или номер' : sentTo === 'login' ? 'Другой логин или номер' : 'Другой номер'

  const enterByPassword = async () => {
    setError('')
    setBusy(true)
    try {
      const temp = await passwordLogin(loginValue(), password)
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
    const problem = passwordProblem(fresh.password, fresh.repeat, knownPhone(), knownLogin())
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
      <form className="form phone-login" aria-label="Вход по логину и паролю" onSubmit={(e) => { e.preventDefault(); void enterByPassword() }}>
        <label className="field"><span>{LOGIN_LABEL}</span>
          <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="off"
            autoCorrect="off" spellCheck={false} maxLength={40} placeholder="aigul или 0555 123 456" />
        </label>
        <PasswordInput label="Пароль" value={password} onChange={setPassword} shown={shown} autoComplete="current-password" />
        <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
        <button type="submit" className={secondary ? 'btn' : 'btn primary'} disabled={busy || !login.trim() || !password}>{busy ? <><Spinner />Входим…</> : 'Войти'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        {canRecover ? (
          <>
            <button type="button" className={error ? 'btn' : 'link'} onClick={() => {
              // Ввели логин или номер — не набирать второй раз
              if (!phone.trim() && login.trim()) setPhone(login.trim())
              go('phone')
            }}>{FORGOT}</button>
          </>
        ) : (
          <p className="hint">Первый вход или забыли пароль? Попросите руководителя клиники задать логин и временный пароль
            («Клиника → Персонал»).</p>
        )}
      </form>
    )
  }

  if (step === 'phone') {
    return (
      <form className="form phone-login" aria-label="Код для входа" onSubmit={(e) => { e.preventDefault(); void next() }}>
        <h2>Первый вход или новый пароль</h2>
        <p className="hint">{mail
          ? 'Впишите логин, номер или почту из «Моего профиля» — пришлём код, вы его подтвердите и придумаете пароль.'
          : 'Впишите логин или номер — пришлём код, вы его подтвердите и придумаете пароль.'} Дальше входите логином или номером и паролем.</p>
        <label className="field"><span>{mail ? RECOVER_LABEL : LOGIN_LABEL}</span>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="username" autoCapitalize="off"
            autoCorrect="off" spellCheck={false} maxLength={254}
            placeholder={mail ? 'aigul, 0555 123 456 или почта' : 'aigul или 0555 123 456'} />
        </label>
        {canRecover && (
          <button type="submit" className="btn primary" disabled={busy || !phone.trim()}>
            {busy ? <><Spinner />Отправляем…</> : 'Получить код'}</button>
        )}
        {mail && <p className="hint small">Вписали почту — код сразу придёт письмом, если она добавлена и подтверждена в «Мой профиль» → «Почта».</p>}
        {telegram && !mail && <p className="hint small">{TELEGRAM_ONLY}</p>}
        {!canRecover && <p className="hint">Коды сейчас не отправляются — попросите руководителя задать временный пароль.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {byPassword && <button type="button" className="link" onClick={() => go('password')}>Назад: вход по паролю</button>}
      </form>
    )
  }

  if (step === 'channel') {
    return (
      <div className="form phone-login" role="group" aria-label="Куда прислать код">
        <h2>Куда прислать код?</h2>
        {entered === 'login' && phone.trim()
          ? <p className="hint">Логин <b>{phone.trim()}</b></p>
          : (phone.trim() || masked) && <p className="hint">Номер <b className="num">{phone.trim() ? phoneText(phoneFromInput(phoneFromText(phone) ?? phone).replace(/\s/g, '')) : masked}</b></p>}
        <div className="code-channels">
          {telegram && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void getCode('auto')}>В Telegram</button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => void getCode('mail')}>На почту из «Моего профиля»</button>
        </div>
        {busy && <p className="hint small" role="status"><Spinner />Отправляем…</p>}
        {telegram && <p className="hint small">В Telegram — от бота клиники, если номер привязан к вашему Telegram (в боте: «📱&nbsp;Поделиться номером»).</p>}
        <p className="hint small">На почту — если вы добавили и подтвердили её в «Мой профиль» → «Почта».</p>
        <p className="hint small">{NO_MAIL}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="link" onClick={anotherNumber}>{anotherLabel}</button>
      </div>
    )
  }

  if (step === 'code') {
    const byEmail = sentTo === 'email'
    const byMail = byEmail || channel === 'mail'
    const lasts = masked ? `ещё ${minutesLeft} мин.` : byMail ? '10 минут.' : '5 минут.'
    return (
      <form className="form phone-login" aria-label="Код подтверждения" onSubmit={(e) => { e.preventDefault(); void confirmCode() }}>
        {byEmail ? (
          <p className="hint" role="status">Код отправлен на почту{masked && <> <b>{masked}</b></>}, если она добавлена в Tish (проверьте
            «Спам»). Код действует {lasts}</p>
        ) : byMail ? (
          <p className="hint" role="status">Если к номеру добавлена почта — код уже в письме (проверьте «Спам»). Код действует {lasts}</p>
        ) : (
          <p className="hint" role="status">{masked && sentTo === 'phone' && <>Код отправлен на <b>{masked}</b>. </>}
            {SENT_TELEGRAM} Код действует {lasts}</p>
        )}
        <CodeInput value={code} onChange={setCode} />
        <button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? <><Spinner />Проверяем…</> : 'Подтвердить'}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <ResendLink wait={wait} busy={busy} onAgain={() => void getCode(byMail ? 'mail' : 'auto')} />
          {mail && !byEmail && <button type="button" className="link" disabled={busy} onClick={() => go('channel')}>Другой способ</button>}
          <button type="button" className="link" onClick={anotherNumber}>{anotherLabel}</button>
        </div>
        {byMail && <p className="hint small">{byEmail ? NO_MAIL_BY_EMAIL : NO_MAIL}</p>}
        {/* Сервер не скажет, что номера нет (по ответу не узнать чужой номер), — частая причина «не пришло»:
            сотрудник работает через Telegram, а номер для входа ещё не привязал */}
        {telegram && !byMail && wait === 0 && (
          <p className="hint small">Не приходит код? Если вы работаете в Tish через Telegram, сначала привяжите номер: в боте
            нажмите «📱&nbsp;Поделиться номером» или в приложении — нажмите на себя внизу меню → «Мой профиль» → «Телефон».
            {mail ? ' Или «Другой способ» — код на почту.' : ' Нет Telegram — попросите руководителя клиники выдать временный пароль.'}</p>
        )}
      </form>
    )
  }

  return (
    <form className="form phone-login" aria-label="Придумайте пароль" onSubmit={(e) => { e.preventDefault(); void savePassword() }}>
      <h2>Придумайте пароль</h2>
      <p className="hint">{temporary
        ? 'Временный пароль подошёл. Придумайте свой — дальше входите логином или номером и им.'
        : sentTo === 'phone'
          ? `Номер${masked ? ` ${masked}` : ''} подтверждён. Дальше входите номером (или логином из «Моего профиля») и этим паролем.`
          : 'Код подтверждён. Дальше входите номером (или логином из «Моего профиля») и этим паролем.'}</p>
      <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone={knownPhone()} login={knownLogin()}
        onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
      <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner />Сохраняем…</> : 'Сохранить и войти'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}
