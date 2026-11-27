import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  api, ApiError, telegramChangeStart, telegramChangeStatus, telegramConnectStart, telegramConnectStatus, unwrap,
  type TelegramConnectStatus,
} from '../api/client'
import { HelpHint } from '../help/HelpHint'
import { LoginQr } from '../layout/LoginQr'
import { Loading, Spinner } from '../layout/Loading'
import { copyText } from '../lib/clipboard'
import { notify } from '../lib/confirm'
import { useQrScreen } from '../lib/qrScreen'
import { reloadPage } from '../lib/reload'
import { telegram } from '../lib/telegram'

/** Как часто спрашиваем сервер, пока ждём кнопку в боте. */
export const TELEGRAM_POLL_MS = 2000

export const CHANGE_HINT = 'Завели отдельный Telegram для работы — перенесите туда вход в Tish. Роль, пациенты, график, касса, номер и пароль останутся те же; старый Telegram больше не будет входить в клинику. Записи к врачу как пациента остаются у старого Telegram.'

/** Телефон: ссылку открывают в другом аккаунте того же Telegram. */
export const PHONE_STEPS = 'Откройте ссылку в новом аккаунте Telegram: переключите аккаунт в Telegram (Настройки → аккаунт вверху) и нажмите ссылку — или скопируйте её и отправьте себе в новый аккаунт («Избранное»).'

/** Компьютер: QR-кодом телефоном, где открыт новый Telegram. */
export const QR_STEPS = 'Наведите камеру телефона, где открыт НОВЫЙ Telegram, или откройте ссылку в нём. В боте нажмите «✅ Да, перенести».'

type Mode = 'change' | 'connect'

type Step = { kind: 'idle' } | { kind: 'starting' } | { kind: 'waiting'; link: string } | { kind: 'done' }

/**
 * «Telegram» в «Моём профиле»: как вы входите и как это поменять.
 * <ul>
 * <li>Telegram есть — «Сменить Telegram»: ссылка t.me/<бот>?start=tgmove_… для НОВОГО аккаунта. На компьютере — QR-код
 * (телефоном с новым Telegram), на телефоне и в Mini App — «переключите аккаунт или перешлите ссылку себе» и
 * «Скопировать ссылку». В боте «✅ Да, перенести» — сервер переносит вход, страница по своей HttpOnly-cookie получает
 * новую сессию и перезагружается. В Mini App старого Telegram клиника дальше не откроется — там только «Готово, откройте
 * Tish в новом Telegram».</li>
 * <li>Telegram нет (вход по номеру) — «📲 Подключить Telegram», та же схема («✅ Да, это я»).</li>
 * </ul>
 * Ссылку и итог не храним нигде, кроме памяти страницы.
 */
export function TelegramSection() {
  const state = useQuery({ queryKey: ['me-telegram'], queryFn: () => unwrap(api.GET('/api/me/telegram')) })
  if (state.isPending) return <Loading />
  if (state.error) return null
  return (
    <section className="settings-group" aria-label="Telegram">
      <h2>Telegram</h2>
      <TelegramCard mode={state.data.telegram ? 'change' : 'connect'} available={state.data.available} />
    </section>
  )
}

function TelegramCard({ mode, available }: { mode: Mode; available: boolean }) {
  const client = useQueryClient()
  const qr = useQrScreen()
  const inTelegram = Boolean(telegram())
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const change = mode === 'change'

  const start = async () => {
    setError('')
    setCopied('')
    setStep({ kind: 'starting' })
    try {
      const started = change ? await telegramChangeStart() : await telegramConnectStart()
      setStep({ kind: 'waiting', link: started.link })
    } catch (e) {
      setStep({ kind: 'idle' })
      setError(e instanceof ApiError ? e.message : 'Не получилось — попробуйте ещё раз')
    }
  }

  usePoll(step.kind === 'waiting', change ? telegramChangeStatus : telegramConnectStatus, (s) => {
    if (s.state === 'linked') {
      setStep({ kind: 'done' })
      // В Mini App старого Telegram вход уже не действует — только сказать, куда идти
      if (inTelegram) return
      void notify(change ? 'Вход перенесён на новый Telegram. Бот прислал туда «Открыть день».'
        : 'Telegram подключён — бот прислал «Открыть день».').then(() => {
        void client.invalidateQueries()
        reloadPage()
      })
      return
    }
    setStep({ kind: 'idle' })
    if (s.state === 'failed') setError(s.error ?? 'Не получилось')
    else if (s.state === 'cancelled') setError(change ? 'Перенос отменён в Telegram.' : 'Подключение отменено в Telegram.')
    else setError('Ссылка устарела — нажмите ещё раз.')
  })

  if (step.kind === 'done') {
    return (
      <div className="card-block">
        <p className="tone-ok" role="status">{change
          ? '✅ Вход перенесён на новый Telegram. Откройте Tish в новом аккаунте — бот прислал «Открыть день». Здесь клиника больше не откроется.'
          : '✅ Telegram подключён — бот прислал «Открыть день».'}</p>
      </div>
    )
  }

  const copy = async (link: string) => setCopied(await copyText(link)
    ? 'Ссылка скопирована — отправьте её себе в новый аккаунт Telegram'
    : 'Не получилось скопировать — выделите ссылку выше')

  return (
    <div className="card-block telegram-card">
      <div className="setting-line">
        <div className="setting-what">
          <p className={change ? 'tone-ok' : 'hint'}>{change ? '✓ Вы входите через Telegram' : 'Telegram не подключён — вход по номеру и паролю'}</p>
          <p className="hint setting-sub">{change ? 'Telegram для работы — можно перенести вход на другой аккаунт' : 'С Telegram Tish всегда под рукой: кнопка «Открыть день» в боте'}{' '}
            <HelpHint title={change ? 'Сменить Telegram' : 'Подключить Telegram'}>{change ? CHANGE_HINT : 'Бот Tish пришлёт кнопку «Открыть день»; номер и пароль для входа тоже останутся.'}</HelpHint></p>
        </div>
        {step.kind !== 'waiting' && available && (
          <div className="setting-actions">
            <button type="button" className="btn" disabled={step.kind === 'starting'} onClick={() => void start()}>
              {step.kind === 'starting' ? <><Spinner />Готовим ссылку…</> : change ? 'Сменить Telegram' : '📲 Подключить Telegram'}</button>
          </div>
        )}
      </div>
      {!available && <p className="hint">Бот Tish сейчас не настроен — попробуйте позже.</p>}
      {step.kind === 'waiting' && (
        <div className="telegram-change" aria-label={change ? 'Сменить Telegram' : 'Подключить Telegram'}>
          {qr ? (
            <LoginQr link={step.link} onRefresh={() => void start()} caption={change ? QR_STEPS : 'Наведите камеру телефона с Telegram или откройте ссылку. В боте нажмите «✅ Да, это я».'} />
          ) : (
            <p className="hint">{change ? PHONE_STEPS : 'Откройте ссылку в Telegram и нажмите в боте «✅ Да, это я».'}</p>
          )}
          <a className="invite-link" href={step.link} target="_blank" rel="noopener noreferrer">{step.link}</a>
          <div className="actions">
            {!qr && <button type="button" className="btn primary" onClick={() => void copy(step.link)}>Скопировать ссылку</button>}
            {qr && <button type="button" className="btn" onClick={() => void copy(step.link)}>Скопировать ссылку</button>}
            <button type="button" className="btn ghost" onClick={() => setStep({ kind: 'idle' })}>Отмена</button>
          </div>
          {copied && <p className="hint small" role="status">{copied}</p>}
          <p className="hint" role="status"><Spinner />{change ? 'Ждём «✅ Да, перенести» в новом Telegram… Ссылка действует 15 минут.' : 'Ждём «✅ Да, это я» в Telegram…'}</p>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

/** Пока ждём кнопку в боте: раз в 2 секунды и сразу, когда вернулись во вкладку; итог (не «ждём») — в onResult. */
function usePoll(active: boolean, fetch: () => Promise<TelegramConnectStatus>, onResult: (s: TelegramConnectStatus) => void) {
  const handler = useRef(onResult)
  useEffect(() => { handler.current = onResult })
  useEffect(() => {
    if (!active) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      clearTimeout(timer)
      try {
        const s = await fetch()
        if (!alive) return
        if (s.state !== 'waiting') {
          alive = false
          handler.current(s)
          return
        }
      } catch {
        // Нет связи на секунду — спросим снова
      }
      if (alive) timer = setTimeout(() => void poll(), TELEGRAM_POLL_MS)
    }
    timer = setTimeout(() => void poll(), TELEGRAM_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, fetch])
}
