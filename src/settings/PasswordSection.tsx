import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { notify } from '../lib/confirm'
import { passwordProblem } from '../lib/password'
import { shortDate } from '../lib/time'
import { CodeInput, ResendLink } from '../layout/CodeStep'
import { sentText, useCountdown } from '../lib/otp'
import { NewPasswordFields, PasswordInput, ShowPassword } from '../layout/PasswordFields'
import { Spinner } from '../layout/Loading'
import { HelpHint } from '../help/HelpHint'

type Mode = 'current' | 'code'

/** Сотруднику с Telegram: пароль — только запасной вход по номеру. */
const OPTIONAL_HINT = 'Необязательно. Пароль нужен, только если вы входите без Telegram — по номеру телефона.'

/** Путь «по коду»: «Получить код» → код → «Подтвердить» (пропуск) → новый пароль. */
type CodeStep = 'send' | 'code' | 'new'

/**
 * «Пароль и вход» внизу «Моего профиля» — у всех, у кого указан телефон. Сотрудник с Telegram входит через
 * Telegram (на сайте — «Войти через Telegram» и подтвердить в боте), пароль ему не нужен: блок — с тихой
 * подписью «Необязательно…», кнопка неброская. Без Telegram пароль — его вход по номеру.
 * Сменить — по текущему паролю. Не помню текущий или пароля ещё нет — «Получить код» (сервер шлёт в
 * Telegram, если номер привязан к вашему Telegram, иначе SMS) → код → «Подтвердить» → только потом новый
 * пароль: сервер выдаёт одноразовый пропуск на 10 минут, с ним и сохраняем. После смены другие
 * устройства выходят (сервер поднимает версию пароля), этот браузер остаётся.
 * <p>
 * Ушли в Telegram за кодом, а телефон перезагрузил страницу — при открытии спрашиваем сервер, ждёт ли он код
 * на ваш номер ({@code GET /api/me/password/code}), и сразу открываем шаг «Код» с оставшимся отсчётом.
 */
export function PasswordSection() {
  const client = useQueryClient()
  const state = useQuery({ queryKey: ['me-password'], queryFn: () => unwrap(api.GET('/api/me/password')) })
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('current')
  const [step, setStep] = useState<CodeStep>('send')
  const [current, setCurrent] = useState('')
  const [shown, setShown] = useState(false)
  const [code, setCode] = useState('')
  const [bySms, setBySms] = useState(false)
  const [token, setToken] = useState('')
  const [wait, restart] = useCountdown()
  const [fresh, setFresh] = useState({ password: '', repeat: '' })
  const [error, setError] = useState('')
  const pending = useQuery({
    queryKey: ['me-password-code'], enabled: Boolean(state.data?.phoneLogin), staleTime: Infinity,
    queryFn: () => unwrap(api.GET('/api/me/password/code')),
  })
  const resumed = useRef(false)
  useEffect(() => {
    const p = pending.data
    if (!p?.pending || resumed.current) return
    resumed.current = true
    setMode('code')
    setStep('code')
    setOpen(true)
    restart(p.resendSeconds)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз, когда пришёл ответ
  }, [pending.data])

  const sendCode = useMutation<unknown, ApiError, 'auto' | 'sms'>({
    mutationFn: (channel) => unwrap(api.POST('/api/me/password/code', { body: channel === 'sms' ? { channel } : {} })),
    onSuccess: (_r, channel) => {
      setBySms(channel === 'sms')
      setCode('')
      setStep('code')
      restart()
    },
  })
  const confirmCode = useMutation<Schemas['PasswordControllerSetupToken'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/me/password/confirm', { body: { code } })),
    onSuccess: (r) => {
      setToken(r.setupToken ?? '')
      setFresh({ password: '', repeat: '' })
      setStep('new')
    },
  })
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/password', {
      body: mode === 'code' ? { setupToken: token, newPassword: fresh.password } : { currentPassword: current, newPassword: fresh.password },
    })),
    onSuccess: () => {
      reset()
      void client.invalidateQueries({ queryKey: ['me-password'] })
      void notify('Пароль сохранён. На других устройствах нужно войти заново.')
    },
    onError: (e) => {
      // Пропуск устарел (10 минут) или уже использован — заново через код
      if (e.fieldErrors.setupToken) {
        setToken('')
        setStep('send')
      }
    },
  })

  const s = state.data
  const canCurrent = Boolean(s?.passwordSet && !s.temporary)
  const byTelegram = Boolean(s?.telegramCode)
  const anyCode = byTelegram || Boolean(s?.sms)

  const submit = () => {
    const problem = passwordProblem(fresh.password, fresh.repeat, '')
    setError(problem)
    if (!problem) save.mutate()
  }
  const toCode = () => {
    setMode('code')
    setStep('send')
    setError('')
    save.reset()
  }
  const start = () => {
    setMode(canCurrent ? 'current' : 'code')
    setStep('send')
    setOpen(true)
  }
  const reset = () => {
    setOpen(false)
    setCurrent('')
    setCode('')
    setToken('')
    setStep('send')
    setFresh({ password: '', repeat: '' })
    setError('')
  }
  const close = () => {
    reset()
    save.reset()
    sendCode.reset()
    confirmCode.reset()
  }
  const failure = save.error
  const fieldError = failure?.fieldErrors.currentPassword ?? failure?.fieldErrors.setupToken ?? failure?.fieldErrors.newPassword
  const shownError = error || fieldError || failure?.message || confirmCode.error?.fieldErrors.code || confirmCode.error?.message
    || sendCode.error?.message
  const passwordStep = mode === 'current' || step === 'new'
  if (!s?.phoneLogin) return null
  // С Telegram пароль не нужен: тихая подпись «необязательно», а не «надо сделать» (временный — всё же сменить)
  const optional = Boolean(s.telegram) && !s.temporary

  return (
    <section className="settings-group" aria-label="Пароль и вход">
      <h2>Пароль и вход</h2>
      <div className="card-block">
        {!open ? (
          <div className="setting-line">
            <div className="setting-what">
              {optional ? (
                <p className="hint setting-sub">Необязательно — только для входа по номеру{s.passwordSet && s.setAt ? ` · задан ${shortDate(s.setAt)}` : ''}{' '}
                  <HelpHint title="Пароль">{OPTIONAL_HINT} С Telegram входите кнопкой «Войти через Telegram» — пароль не спросим.</HelpHint></p>
              ) : (
                <p>{s.passwordSet
                  ? s.temporary ? 'Сейчас пароль временный — придумайте свой.' : `Вы входите по номеру и паролю.${s.setAt ? ` Пароль задан ${shortDate(s.setAt)}.` : ''}`
                  : 'Пароль ещё не задан — задайте его по коду.'}</p>
              )}
            </div>
            <button type="button" className="btn" onClick={start}>{s.passwordSet ? 'Сменить пароль' : 'Задать пароль'}</button>
          </div>
        ) : (
          <form className="form narrow" aria-label="Сменить пароль" onSubmit={(e) => {
            e.preventDefault()
            if (passwordStep) submit()
            else if (step === 'code') confirmCode.mutate()
            else sendCode.mutate('auto')
          }}>
            {mode === 'current' ? (
              <>
                <PasswordInput label="Текущий пароль" value={current} onChange={setCurrent} shown={shown} autoComplete="current-password" />
                <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
                {anyCode && <button type="button" className="link" onClick={toCode}>Не помню текущий — подтвердить кодом</button>}
              </>
            ) : step === 'send' ? (
              <>
                <p className="hint">{!anyCode ? 'Коды по SMS пока не подключены. Попросите руководителя клиники задать временный пароль.'
                  : `${byTelegram && s.sms ? 'Пришлём код: бесплатно в Telegram от бота клиники, если номер привязан к вашему Telegram, иначе — SMS на ваш номер.'
                    : byTelegram ? 'Пришлём код в Telegram от бота клиники.' : 'Пришлём код по SMS на ваш номер.'} Подтвердите его — и придумаете новый пароль.`}</p>
                {anyCode && (
                  <div className="actions">
                    <button type="submit" className="btn" disabled={sendCode.isPending}>
                      {sendCode.isPending ? <><Spinner />Отправляем…</> : 'Получить код'}</button>
                  </div>
                )}
                {canCurrent && <button type="button" className="link" onClick={() => { setMode('current'); setError('') }}>Помню текущий пароль</button>}
              </>
            ) : step === 'code' ? (
              <>
                <p className="hint" role="status">{sentText(bySms, byTelegram, Boolean(s.sms))} Код действует 5 минут.</p>
                <CodeInput value={code} onChange={setCode} />
                <ResendLink wait={wait} sms={Boolean(s.sms)} busy={sendCode.isPending}
                  onSms={() => sendCode.mutate('sms')} onAgain={() => sendCode.mutate('auto')} />
              </>
            ) : (
              <p className="hint">Код подтверждён. Придумайте новый пароль.</p>
            )}
            {passwordStep && (
              <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone=""
                onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
            )}
            {shownError && <p className="error" role="alert">{shownError}</p>}
            <div className="actions">
              {passwordStep && (
                <button type="submit" className="btn primary" disabled={save.isPending || (mode === 'current' && !current)}>
                  {save.isPending ? <><Spinner />Сохраняем…</> : 'Сохранить пароль'}</button>
              )}
              {step === 'code' && mode === 'code' && (
                <button type="submit" className="btn primary" disabled={confirmCode.isPending || code.length !== 6}>
                  {confirmCode.isPending ? <><Spinner />Проверяем…</> : 'Подтвердить'}</button>
              )}
              <button type="button" className="btn ghost" onClick={close}>Отмена</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
