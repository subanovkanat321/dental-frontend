import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'
import { notify } from '../lib/confirm'
import { passwordProblem } from '../lib/password'
import { shortDate } from '../lib/time'
import { NewPasswordFields, PasswordInput, ShowPassword } from '../layout/PasswordFields'
import { Spinner } from '../layout/Loading'

type Mode = 'current' | 'code'

/**
 * «Пароль и вход» в «Изменить профиль» — у всех, у кого указан телефон. На сайт теперь входят только по
 * номеру и паролю, поэтому и сотруднику с Telegram пароль нужен (в самом Telegram — не нужен).
 * Задать или сменить — по текущему паролю или по коду: в Telegram (бесплатно, у кого номер привязан к
 * Telegram) или по SMS. После смены другие устройства выходят (сервер поднимает версию пароля), этот
 * браузер остаётся.
 */
export function PasswordSection() {
  const client = useQueryClient()
  const state = useQuery({ queryKey: ['me-password'], queryFn: () => unwrap(api.GET('/api/me/password')) })
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('current')
  const [current, setCurrent] = useState('')
  const [shown, setShown] = useState(false)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<'telegram' | 'sms' | null>(null)
  const [fresh, setFresh] = useState({ password: '', repeat: '' })
  const [error, setError] = useState('')

  const sendCode = useMutation<unknown, ApiError, 'telegram' | 'sms'>({
    mutationFn: (channel) => unwrap(api.POST('/api/me/password/code', { body: { channel } })),
    onSuccess: (_r, channel) => setSent(channel),
  })
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/me/password', {
      body: mode === 'code' ? { code, newPassword: fresh.password } : { currentPassword: current, newPassword: fresh.password },
    })),
    onSuccess: () => {
      setOpen(false)
      setCurrent('')
      setCode('')
      setSent(null)
      setFresh({ password: '', repeat: '' })
      void client.invalidateQueries({ queryKey: ['me-password'] })
      void notify('Пароль сохранён. На других устройствах нужно войти заново.')
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
  const start = () => {
    setMode(canCurrent ? 'current' : 'code')
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setCurrent('')
    setCode('')
    setSent(null)
    setFresh({ password: '', repeat: '' })
    setError('')
    save.reset()
    sendCode.reset()
  }
  const failure = save.error
  const fieldError = failure?.fieldErrors.currentPassword ?? failure?.fieldErrors.code ?? failure?.fieldErrors.newPassword
  const shownError = error || fieldError || failure?.message || sendCode.error?.message
  if (!s?.phoneLogin) return null

  return (
    <section className="settings-group" aria-label="Пароль и вход">
      <h2>Пароль и вход</h2>
      <div className="card-block">
        <p>{s.passwordSet
          ? s.temporary ? 'Сейчас пароль временный — придумайте свой.' : `Вы входите по номеру и паролю.${s.setAt ? ` Пароль задан ${shortDate(s.setAt)}.` : ''}`
          : s.telegram ? 'Пароль ещё не задан. На сайт теперь входят только по номеру и паролю — задайте его (в Telegram пароль не нужен).'
            : 'Пароль ещё не задан — задайте его по коду.'}</p>
        {!open ? (
          <button type="button" className="btn" onClick={start}>{s.passwordSet ? 'Сменить пароль' : 'Задать пароль'}</button>
        ) : (
          <form className="form narrow" aria-label="Сменить пароль" onSubmit={(e) => { e.preventDefault(); submit() }}>
            {mode === 'current' ? (
              <>
                <PasswordInput label="Текущий пароль" value={current} onChange={setCurrent} shown={shown} autoComplete="current-password" />
                <ShowPassword shown={shown} onToggle={() => setShown(!shown)} />
                {anyCode && <button type="button" className="link" onClick={() => { setMode('code'); setError(''); save.reset() }}>
                  {byTelegram ? 'Не помню текущий — подтвердить кодом' : 'Не помню текущий — подтвердить кодом из SMS'}</button>}
              </>
            ) : !sent ? (
              <>
                <p className="hint">{byTelegram ? 'Пришлём код — им подтвердите пароль. В Telegram — бесплатно, в чат с ботом клиники.'
                  : s.sms ? 'Пришлём код на ваш номер — им подтвердите смену пароля.'
                    : 'Коды по SMS пока не подключены. Попросите администратора клиники задать временный пароль.'}</p>
                <div className="actions">
                  {byTelegram && <button type="button" className="btn" disabled={sendCode.isPending} onClick={() => sendCode.mutate('telegram')}>
                    {sendCode.isPending && sendCode.variables === 'telegram' ? <><Spinner />Отправляем…</> : 'Код в Telegram'}</button>}
                  {s.sms && <button type="button" className="btn" disabled={sendCode.isPending} onClick={() => sendCode.mutate('sms')}>
                    {sendCode.isPending && sendCode.variables === 'sms' ? <><Spinner />Отправляем…</> : byTelegram ? 'Код по SMS' : 'Получить код'}</button>}
                </div>
                {canCurrent && <button type="button" className="link" onClick={() => { setMode('current'); setError('') }}>Помню текущий пароль</button>}
              </>
            ) : (
              <label className="field"><span>{sent === 'telegram' ? 'Код из Telegram' : 'Код из SMS'}</span>
                <input value={code} autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="123456"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
            )}
            {(mode === 'current' || sent) && (
              <NewPasswordFields password={fresh.password} repeat={fresh.repeat} phone=""
                onPassword={(v) => setFresh({ ...fresh, password: v })} onRepeat={(v) => setFresh({ ...fresh, repeat: v })} />
            )}
            {shownError && <p className="error" role="alert">{shownError}</p>}
            <div className="actions">
              {(mode === 'current' || sent) && (
                <button type="submit" className="btn primary" disabled={save.isPending || (mode === 'current' ? !current : code.length !== 6)}>
                  {save.isPending ? <><Spinner />Сохраняем…</> : 'Сохранить пароль'}</button>
              )}
              <button type="button" className="btn ghost" onClick={close}>Отмена</button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
